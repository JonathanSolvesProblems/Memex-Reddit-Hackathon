import { Hono } from "hono";
import type {
  OnCommentSubmitRequest,
  OnModActionRequest,
  OnPostSubmitRequest,
  TriggerResponse,
} from "@devvit/web/shared";
import { context } from "@devvit/web/server";
import { createRulebookPost } from "../core/post";
import { getCurrentRulebookPost, getConclaveByTarget, wasRouted } from "../core/redis";
import { buildPostSnippet } from "../core/embed";
import { evaluateAutoRoute, getAuthorCreatedAt } from "../core/router";
import { spawnConclave, type SpawnInput } from "../core/spawn";
import { recordDecision } from "../core/retrieve";
import { loadSettings } from "../core/settings";
import type { TargetKind, VoteChoice } from "../../shared/types";

export const triggers = new Hono();

const ok = (c: { json: (b: TriggerResponse, s?: number) => Response }) =>
  c.json({}, 200);

/** On install, drop a Living Rulebook post so the team has a home immediately. */
triggers.post("/on-app-install", async (c) => {
  try {
    const existing = await getCurrentRulebookPost();
    if (!existing) await createRulebookPost();
  } catch (e) {
    console.error("[Memex] on-app-install failed:", e);
  }
  return ok(c);
});

triggers.post("/on-app-upgrade", async (c) => {
  try {
    const existing = await getCurrentRulebookPost();
    if (!existing) await createRulebookPost();
  } catch (e) {
    console.error("[Memex] on-app-upgrade failed:", e);
  }
  return ok(c);
});

/** Auto-route freshly submitted posts into a Conclave when criteria match. */
triggers.post("/on-post-submit", async (c) => {
  try {
    const { post, author } = await c.req.json<OnPostSubmitRequest>();
    const settings = await loadSettings();
    if (settings.autoRouteEnabled && post && !(await wasRouted(post.id))) {
      const snippet = buildPostSnippet({
        title: post.title,
        body: post.selftext,
        url: post.url,
      });
      const authorName = author?.name ?? "unknown";
      const createdAt =
        author?.name !== undefined
          ? await getAuthorCreatedAt(author.name)
          : undefined;
      const decision = evaluateAutoRoute(
        {
          contentText: snippet,
          authorName,
          reportCount: 0,
          authorCreatedAt: createdAt,
        },
        settings,
        { ignoreReports: true },
      );
      if (decision.route) {
        const input: SpawnInput = {
          subredditName: context.subredditName,
          targetKind: "post",
          targetId: post.id,
          authorName,
          contentSnippet: snippet,
          permalink: post.permalink,
          openedBy: "auto-router",
          reason: `Auto-routed: ${decision.reason}`,
        };
        await spawnConclave(input, settings);
      }
    }
  } catch (e) {
    console.error("[Memex] on-post-submit failed:", e);
  }
  return ok(c);
});

/** Auto-route freshly submitted comments into a Conclave when criteria match. */
triggers.post("/on-comment-submit", async (c) => {
  try {
    const { comment, author } = await c.req.json<OnCommentSubmitRequest>();
    const settings = await loadSettings();
    if (settings.autoRouteEnabled && comment && !(await wasRouted(comment.id))) {
      const authorName = author?.name ?? comment.author ?? "unknown";
      const createdAt =
        author?.name !== undefined
          ? await getAuthorCreatedAt(author.name)
          : undefined;
      const decision = evaluateAutoRoute(
        {
          contentText: comment.body,
          authorName,
          reportCount: 0,
          authorCreatedAt: createdAt,
        },
        settings,
        { ignoreReports: true },
      );
      if (decision.route) {
        const input: SpawnInput = {
          subredditName: context.subredditName,
          targetKind: "comment",
          targetId: comment.id,
          authorName,
          contentSnippet: comment.body,
          permalink: comment.permalink,
          openedBy: "auto-router",
          reason: `Auto-routed: ${decision.reason}`,
        };
        await spawnConclave(input, settings);
      }
    }
  } catch (e) {
    console.error("[Memex] on-comment-submit failed:", e);
  }
  return ok(c);
});

// Native moderator actions Memex learns from, mapped to a precedent outcome.
const ACTION_OUTCOME: Record<string, { choice: VoteChoice; kind: TargetKind }> = {
  removelink: { choice: "remove", kind: "post" },
  spamlink: { choice: "remove", kind: "post" },
  approvelink: { choice: "keep", kind: "post" },
  removecomment: { choice: "remove", kind: "comment" },
  spamcomment: { choice: "remove", kind: "comment" },
  approvecomment: { choice: "keep", kind: "comment" },
};

/**
 * The institutional-memory backbone: every manual remove/approve a moderator
 * takes is recorded as a precedent, so Decision DNA reflects the whole team's
 * real behavior, not just Conclave outcomes. Skips items Memex itself routed
 * (those are recorded as team-consensus) to avoid double-counting.
 */
triggers.post("/on-mod-action", async (c) => {
  try {
    const { action, moderator, targetPost, targetComment } =
      await c.req.json<OnModActionRequest>();
    const mapped = action ? ACTION_OUTCOME[action] : undefined;
    if (!mapped) return ok(c);

    const target = mapped.kind === "post" ? targetPost : targetComment;
    if (!target?.id) return ok(c);

    if (await getConclaveByTarget(target.id)) return ok(c);

    const snippet =
      mapped.kind === "post" && targetPost
        ? buildPostSnippet({
            title: targetPost.title,
            body: targetPost.selftext,
            url: targetPost.url,
          })
        : (targetComment?.body ?? "");
    if (!snippet.trim()) return ok(c);

    const permalink =
      mapped.kind === "post"
        ? (targetPost?.permalink ?? "")
        : (targetComment?.permalink ?? "");

    await recordDecision({
      id: `solo_${target.id}`,
      subredditName: context.subredditName,
      targetKind: mapped.kind,
      contentSnippet: snippet,
      action: mapped.choice,
      modName: moderator?.name ?? "moderator",
      reason: action ?? "mod action",
      permalink,
      decidedAt: Date.now(),
    });
  } catch (e) {
    console.error("[Memex] on-mod-action failed:", e);
  }
  return ok(c);
});
