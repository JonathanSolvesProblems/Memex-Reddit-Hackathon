import { Hono } from "hono";
import { context, reddit } from "@devvit/web/server";
import type {
  ErrorResponse,
  InitResponse,
  PresenceResponse,
  ProbeRequest,
  ProbeResponse,
  VoteRequest,
  VoteResponse,
} from "../../shared/api";
import {
  countActiveViewers,
  getConclaveByPost,
  touchViewer,
} from "../core/redis";
import { buildConclaveState, buildRulebookData } from "../core/views";
import { submitVote } from "../core/vote";
import { loadSettings } from "../core/settings";
import { isCurrentUserMod } from "../core/mods";
import { analyzeDecision, formatDecisionDNA } from "../core/retrieve";
import { getSemanticConfig } from "../core/semantic";
import type { VoteChoice } from "../../shared/types";

export const api = new Hono();

const VALID_CHOICES: VoteChoice[] = ["remove", "keep", "warn", "escalate"];

/** Classifies the current post and returns the matching screen's initial data. */
api.get("/init", async (c) => {
  const { postId, subredditName } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: "error", message: "postId missing from context" },
      400,
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? undefined;
    const conclave = await getConclaveByPost(postId);

    if (conclave) {
      const [isModerator, state] = await Promise.all([
        isCurrentUserMod(),
        buildConclaveState(conclave, username),
      ]);
      return c.json<InitResponse>({
        type: "init",
        view: "conclave",
        postId,
        username: username ?? "anonymous",
        isModerator,
        conclave: state,
      });
    }

    const [isModerator, rulebook] = await Promise.all([
      isCurrentUserMod(),
      buildRulebookData(subredditName),
    ]);
    return c.json<InitResponse>({
      type: "init",
      view: "rulebook",
      postId,
      username: username ?? "anonymous",
      isModerator,
      rulebook,
    });
  } catch (error) {
    console.error(`[Memex] /api/init failed for ${postId}:`, error);
    return c.json<ErrorResponse>(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to initialize",
      },
      400,
    );
  }
});

/** Live Conclave state for the current post (polled by the decision room). */
api.get("/conclave", async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: "error", message: "postId missing" },
      400,
    );
  }
  const conclave = await getConclaveByPost(postId);
  if (!conclave) {
    return c.json<ErrorResponse>(
      { status: "error", message: "No conclave for this post" },
      404,
    );
  }
  const username = (await reddit.getCurrentUsername()) ?? undefined;
  const state = await buildConclaveState(conclave, username);
  return c.json(state);
});

/** Casts (or updates) the current moderator's vote on this post's conclave. */
api.post("/vote", async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<VoteResponse>(
      { ok: false, message: "postId missing" },
      400,
    );
  }

  const isMod = await isCurrentUserMod();
  if (!isMod) {
    return c.json<VoteResponse>(
      { ok: false, message: "Only moderators can vote in a Conclave." },
      403,
    );
  }

  const username = await reddit.getCurrentUsername();
  if (!username) {
    return c.json<VoteResponse>(
      { ok: false, message: "Could not identify the voting moderator." },
      400,
    );
  }

  const body = await c.req.json<VoteRequest>().catch(() => null);
  if (!body || !VALID_CHOICES.includes(body.choice)) {
    return c.json<VoteResponse>(
      { ok: false, message: "Invalid vote choice." },
      400,
    );
  }

  const conclave = await getConclaveByPost(postId);
  if (!conclave) {
    return c.json<VoteResponse>(
      { ok: false, message: "No conclave for this post." },
      404,
    );
  }

  const settings = await loadSettings();
  const result = await submitVote(
    {
      conclaveId: conclave.id,
      modName: username,
      choice: body.choice,
      reason: (body.reason ?? "").slice(0, 200),
    },
    settings,
  );

  // Re-read the (possibly now-resolved) conclave so the client reflects truth.
  const fresh = (await getConclaveByPost(postId)) ?? conclave;
  const state = await buildConclaveState(fresh, username, settings);
  return c.json<VoteResponse>({ ...result, state });
});

/** Fresh Living Rulebook snapshot (dashboard refresh). */
api.get("/rulebook", async (c) => {
  const { subredditName } = context;
  const rulebook = await buildRulebookData(subredditName);
  return c.json(rulebook);
});

/** Heartbeat presence ping for the current post's conclave. */
api.post("/presence", async (c) => {
  const { postId } = context;
  if (!postId) return c.json<PresenceResponse>({ viewers: 0 });
  const conclave = await getConclaveByPost(postId);
  if (!conclave) return c.json<PresenceResponse>({ viewers: 0 });
  const username = (await reddit.getCurrentUsername()) ?? "viewer";
  await touchViewer(conclave.id, username);
  const viewers = await countActiveViewers(conclave.id);
  return c.json<PresenceResponse>({ viewers });
});

/** Runs Decision DNA against arbitrary text (the Rulebook "test a phrase" tool). */
api.post("/probe", async (c) => {
  const body = await c.req.json<ProbeRequest>().catch(() => null);
  const text = (body?.text ?? "").trim();
  if (!text) {
    return c.json<ErrorResponse>(
      { status: "error", message: "No text to analyze." },
      400,
    );
  }
  const settings = await loadSettings();
  const [analysis, sem] = await Promise.all([
    analyzeDecision(text, {
      limit: settings.precedentLimit,
      minSimilarity: settings.precedentMinSimilarity,
      topK: 3,
    }),
    getSemanticConfig(),
  ]);
  return c.json<ProbeResponse>({
    analysis,
    dna: formatDecisionDNA(analysis),
    semanticEnabled: sem.enabled,
  });
});
