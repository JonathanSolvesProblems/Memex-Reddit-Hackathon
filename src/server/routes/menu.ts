import { Hono } from "hono";
import type { Form, MenuItemRequest, UiResponse } from "@devvit/web/shared";
import { context, reddit } from "@devvit/web/server";
import { createRulebookPost } from "../core/post";
import {
  getCurrentRulebookPost,
  isShadowMod,
  setShadowMod,
} from "../core/redis";
import {
  spawnInputForComment,
  spawnInputForPost,
  stashPendingRoute,
} from "../core/target";
import { loadSettings } from "../core/settings";
import { seedDemoData, clearDemoData } from "../core/seed";
import { runConsistencySweep } from "../core/audit";
import { runWeeklyDigest } from "../core/digest";
import { analyzeDecision, formatDecisionDNA } from "../core/retrieve";

export const menu = new Hono();

const ROUTE_FORM: Form = {
  title: "Send to a Conclave",
  description:
    "Open an async decision room. Memex shows the team's Decision DNA for similar past content, mods vote, and quorum auto-applies the outcome.",
  acceptLabel: "Open Conclave",
  fields: [
    {
      type: "paragraph",
      name: "reason",
      label: "Why route this? (optional)",
      helpText: "A short note for your team. Each mod also gives a per-vote reason.",
    },
  ],
};

function postLink(postId: string): string {
  return `https://www.reddit.com/r/${context.subredditName}/comments/${postId.replace(/^t3_/, "")}`;
}

function dnaForm(dna: string): Form {
  return {
    title: "Decision DNA",
    description: "How your team has historically ruled on similar content.",
    acceptLabel: "Done",
    fields: [
      {
        type: "paragraph",
        name: "dna",
        label: "Team precedent",
        defaultValue: dna,
        disabled: true,
      },
    ],
  };
}

/** Reads a target's content and shows its Decision DNA, no Conclave required. */
async function showDna(snippet: string): Promise<UiResponse> {
  const settings = await loadSettings();
  const analysis = await analyzeDecision(snippet, {
    limit: settings.precedentLimit,
    minSimilarity: settings.precedentMinSimilarity,
    topK: 3,
  });
  return { showForm: { name: "dnaForm", form: dnaForm(formatDecisionDNA(analysis)) } };
}

/** Post menu: instant Decision DNA for this post. */
menu.post("/dna-post", async (c) => {
  try {
    const { targetId } = await c.req.json<MenuItemRequest>();
    const input = await spawnInputForPost(targetId, "viewer", "");
    return c.json<UiResponse>(await showDna(input.contentSnippet));
  } catch (e) {
    console.error("[Memex] dna-post failed:", e);
    return c.json<UiResponse>({ showToast: "Could not read this post." }, 400);
  }
});

/** Comment menu: instant Decision DNA for this comment. */
menu.post("/dna-comment", async (c) => {
  try {
    const { targetId } = await c.req.json<MenuItemRequest>();
    const input = await spawnInputForComment(targetId, "viewer", "");
    return c.json<UiResponse>(await showDna(input.contentSnippet));
  } catch (e) {
    console.error("[Memex] dna-comment failed:", e);
    return c.json<UiResponse>({ showToast: "Could not read this comment." }, 400);
  }
});

/** Post overflow menu: stash the target, then show the routing-reason form. */
menu.post("/route-post", async (c) => {
  try {
    const { targetId } = await c.req.json<MenuItemRequest>();
    const user = (await reddit.getCurrentUsername()) ?? "a moderator";
    const input = await spawnInputForPost(targetId, user, "");
    await stashPendingRoute(user, input);
    return c.json<UiResponse>({ showForm: { name: "routeForm", form: ROUTE_FORM } });
  } catch (e) {
    console.error("[Memex] route-post failed:", e);
    return c.json<UiResponse>({ showToast: "Could not read this post." }, 400);
  }
});

/** Comment overflow menu: same flow for a comment target. */
menu.post("/route-comment", async (c) => {
  try {
    const { targetId } = await c.req.json<MenuItemRequest>();
    const user = (await reddit.getCurrentUsername()) ?? "a moderator";
    const input = await spawnInputForComment(targetId, user, "");
    await stashPendingRoute(user, input);
    return c.json<UiResponse>({ showForm: { name: "routeForm", form: ROUTE_FORM } });
  } catch (e) {
    console.error("[Memex] route-comment failed:", e);
    return c.json<UiResponse>({ showToast: "Could not read this comment." }, 400);
  }
});

/** Subreddit menu: open the Living Rulebook (reuse the singleton if it exists). */
menu.post("/open-rulebook", async (c) => {
  try {
    const existing = await getCurrentRulebookPost();
    const postId = existing ?? (await createRulebookPost()).id;
    return c.json<UiResponse>({ navigateTo: postLink(postId) });
  } catch (e) {
    console.error("[Memex] open-rulebook failed:", e);
    return c.json<UiResponse>({ showToast: "Could not open the Rulebook." }, 400);
  }
});

/** Subreddit menu: seed the demo precedent corpus + calibration trail. */
menu.post("/seed-demo", async (c) => {
  try {
    const res = await seedDemoData();
    return c.json<UiResponse>({
      showToast: {
        text: `Seeded ${res.decisions} demo decisions${res.shadowMod ? ` and put u/${res.shadowMod} in shadow mode` : ""}.`,
        appearance: "success",
      },
    });
  } catch (e) {
    console.error("[Memex] seed-demo failed:", e);
    return c.json<UiResponse>({ showToast: "Seeding failed." }, 400);
  }
});

/** Subreddit menu: remove all seeded demo data. */
menu.post("/clear-demo", async (c) => {
  try {
    const removed = await clearDemoData();
    return c.json<UiResponse>({
      showToast: `Cleared ${removed} seeded demo decisions.`,
    });
  } catch (e) {
    console.error("[Memex] clear-demo failed:", e);
    return c.json<UiResponse>({ showToast: "Clearing failed." }, 400);
  }
});

/** Subreddit menu: run the retrospective Consistency Sweep on demand. */
menu.post("/run-sweep", async (c) => {
  try {
    const settings = await loadSettings();
    const res = await runConsistencySweep(settings);
    return c.json<UiResponse>({
      showToast: {
        text: `Sweep scanned ${res.scanned}, flagged ${res.flagged}, reported ${res.reported}.`,
        appearance: "success",
      },
    });
  } catch (e) {
    console.error("[Memex] run-sweep failed:", e);
    return c.json<UiResponse>({ showToast: "Sweep failed." }, 400);
  }
});

/** Subreddit menu: send the weekly calibration digest on demand. */
menu.post("/run-digest", async (c) => {
  try {
    await runWeeklyDigest();
    return c.json<UiResponse>({
      showToast: {
        text: "Calibration digest sent to mod inbox (if any shadow mods have activity).",
        appearance: "success",
      },
    });
  } catch (e) {
    console.error("[Memex] run-digest failed:", e);
    return c.json<UiResponse>({ showToast: "Digest failed." }, 400);
  }
});

/** Subreddit menu: toggle the calling moderator's shadow (calibration) mode. */
menu.post("/toggle-shadow", async (c) => {
  try {
    const user = await reddit.getCurrentUsername();
    if (!user) {
      return c.json<UiResponse>({ showToast: "Could not identify you." }, 400);
    }
    const now = await isShadowMod(user);
    await setShadowMod(user, !now);
    return c.json<UiResponse>({
      showToast: {
        text: now
          ? "Shadow mode OFF. Your votes now count toward quorum."
          : "Shadow mode ON. Your votes are recorded for calibration but don't count.",
        appearance: "success",
      },
    });
  } catch (e) {
    console.error("[Memex] toggle-shadow failed:", e);
    return c.json<UiResponse>({ showToast: "Could not toggle shadow mode." }, 400);
  }
});
