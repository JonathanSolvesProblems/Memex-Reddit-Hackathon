import { Devvit } from "@devvit/public-api";
import type { Context, MenuItemOnPressEvent } from "@devvit/public-api";
import { spawnConclave } from "./conclave/spawn.js";
import { analyzeDecision, formatDecisionDNA } from "./precedent/retrieve.js";
import { buildPostSnippet } from "./precedent/embed.js";
import { clearDemoData, seedDemoData } from "./seed.js";
import {
  isShadowMod,
  listShadowMods,
  setShadowMod,
} from "./redis.js";
import { loadSettings } from "./settings.js";

const PENDING_TTL_MS = 10 * 60 * 1000;

async function pendingKey(context: Context): Promise<string> {
  const userId =
    context.userId ?? (await context.reddit.getCurrentUser())?.id ?? "anon";
  return `pending-conclave:${userId}`;
}

const reasonForm = Devvit.createForm(
  {
    title: "Send to Conclave",
    acceptLabel: "Open Conclave",
    fields: [
      {
        name: "reason",
        label: "Why is this borderline? (1 line, optional)",
        type: "string",
        helpText: "Surfaces in the Conclave room and in modmail.",
      },
    ],
  },
  async (event, context) => {
    const reason = String(event.values.reason ?? "");
    const raw = await context.redis.get(await pendingKey(context));
    if (!raw) {
      context.ui.showToast("Selection expired. Please try the menu again.");
      return;
    }
    const { targetId, targetKind } = JSON.parse(raw) as {
      targetId: string;
      targetKind: "post" | "comment";
    };
    await openConclaveFor(context, targetId, targetKind, reason);
  },
);

async function openConclaveFor(
  context: Context,
  targetId: string,
  targetKind: "post" | "comment",
  reason: string,
): Promise<void> {
  try {
    const settings = await loadSettings(context);
    const subredditName = await context.reddit.getCurrentSubredditName();
    const user = await context.reddit.getCurrentUser();
    const openedBy = user?.username ?? "unknown";

    let authorName = "unknown";
    let contentSnippet = "";
    let permalink = "";

    if (targetKind === "post") {
      const post = await context.reddit.getPostById(targetId);
      authorName = post.authorName;
      contentSnippet = buildPostSnippet({
        title: post.title,
        body: (post as unknown as { body?: string }).body,
        url: post.url,
      });
      permalink = post.permalink;
    } else {
      const comment = await context.reddit.getCommentById(targetId);
      authorName = comment.authorName;
      contentSnippet = comment.body;
      permalink = comment.permalink;
    }

    const result = await spawnConclave(
      context,
      {
        subredditName,
        targetKind,
        targetId,
        authorName,
        contentSnippet,
        permalink,
        openedBy,
        reason: reason || "manual route",
      },
      settings,
    );

    if (result.alreadyExisted) {
      context.ui.showToast("A Conclave already exists for this item. Opening it.");
      const existingPostId = result.conclave?.conclavePostId;
      if (existingPostId) {
        const existingPost = await context.reddit.getPostById(existingPostId);
        context.ui.navigateTo(existingPost);
      }
      return;
    }
    context.ui.showToast("Conclave opened. Notified team via modmail.");
    if (result.post) {
      context.ui.navigateTo(result.post);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.ui.showToast(`Conclave failed: ${message.slice(0, 180)}`);
  }
}

function targetKindFromId(id: string): "post" | "comment" {
  return id.startsWith("t1_") ? "comment" : "post";
}

function registerSendToConclave(): void {
  Devvit.addMenuItem({
    label: "Memex: Send to Conclave",
    location: ["post", "comment"],
    forUserType: "moderator",
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const targetId = event.targetId;
      if (!targetId) {
        context.ui.showToast("Could not determine target.");
        return;
      }
      await context.redis.set(
        await pendingKey(context),
        JSON.stringify({ targetId, targetKind: targetKindFromId(targetId) }),
        { expiration: new Date(Date.now() + PENDING_TTL_MS) },
      );
      context.ui.showForm(reasonForm);
    },
  });
}

const decisionDnaForm = Devvit.createForm(
  (data) => ({
    title: "🧬 Decision DNA",
    description: (data.summary as string | undefined) ?? "No data.",
    acceptLabel: "Close",
    fields: [],
  }),
  async () => {
    // read-only modal; nothing to submit
  },
);

function registerDecisionDNA(): void {
  Devvit.addMenuItem({
    label: "Memex: Decision DNA",
    location: ["post", "comment"],
    forUserType: "moderator",
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const targetId = event.targetId;
      if (!targetId) {
        context.ui.showToast("Could not determine target.");
        return;
      }
      let snippet = "";
      if (targetKindFromId(targetId) === "post") {
        const post = await context.reddit.getPostById(targetId);
        snippet = buildPostSnippet({
          title: post.title,
          body: (post as unknown as { body?: string }).body,
          url: post.url,
        });
      } else {
        const comment = await context.reddit.getCommentById(targetId);
        snippet = comment.body;
      }
      const settings = await loadSettings(context);
      const analysis = await analyzeDecision(context, snippet, {
        limit: settings.precedentLimit,
        minSimilarity: settings.precedentMinSimilarity,
        topK: 3,
      });
      context.ui.showForm(decisionDnaForm, {
        summary: formatDecisionDNA(analysis),
      });
    },
  });
}

function registerToggleShadow(): void {
  Devvit.addMenuItem({
    label: "Memex: Toggle shadow mode for a mod",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      const subredditName = await context.reddit.getCurrentSubredditName();
      const mods = await context.reddit
        .getModerators({ subredditName })
        .all();
      const me = (await context.reddit.getCurrentUser())?.username;
      const names = mods
        .map((m) => m.username)
        .filter((n) => n && n !== "AutoModerator" && !n.endsWith("-mod"));
      const shadowSet = new Set(await listShadowMods(context.redis));
      context.ui.showForm(toggleShadowForm, {
        mods: names,
        defaultMod: me && names.includes(me) ? me : names[0] ?? "",
        shadowList: [...shadowSet],
      });
    },
  });
}

const toggleShadowForm = Devvit.createForm(
  (data) => {
    const mods = (data.mods as string[] | undefined) ?? [];
    const shadowList = new Set((data.shadowList as string[] | undefined) ?? []);
    const defaultMod = (data.defaultMod as string | undefined) ?? mods[0] ?? "";
    return {
      title: "Shadow mode",
      acceptLabel: "Apply",
      description:
        "Shadow mods cast votes that are logged for calibration but don't count toward quorum.",
      fields: [
        {
          name: "username",
          label: "Moderator",
          type: "select",
          required: true,
          options: mods.map((m) => ({
            label: shadowList.has(m) ? `${m} (currently shadow)` : m,
            value: m,
          })),
          defaultValue: [defaultMod],
        },
        {
          name: "enable",
          label: "Enable shadow mode (turn off to graduate to full vote)",
          type: "boolean",
          defaultValue: true,
        },
      ],
    };
  },
  async (event, context) => {
    const raw = event.values.username;
    const username = Array.isArray(raw) ? String(raw[0]) : String(raw ?? "");
    if (!username) {
      context.ui.showToast("No moderator selected.");
      return;
    }
    const enable = Boolean(event.values.enable);
    const before = await isShadowMod(context.redis, username);
    await setShadowMod(context.redis, username, enable);
    context.ui.showToast(
      enable
        ? `u/${username} is now in shadow mode${before ? " (already was)" : ""}.`
        : `u/${username} graduated from shadow mode${before ? "" : " (was not in shadow)"}.`,
    );
  },
);

function registerOpenRulebook(): void {
  Devvit.addMenuItem({
    label: "Memex: Open Living Rulebook",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      const sub = await context.reddit.getCurrentSubreddit();
      const post = await context.reddit.submitPost({
        title: "Memex: Living Rulebook",
        subredditName: sub.name,
        preview: (
          <vstack alignment="middle center" grow padding="medium">
            <text size="medium">Loading the team's decision history…</text>
          </vstack>
        ),
      });
      await context.redis.set(`rulebook-post:${post.id}`, "1");
      context.ui.showToast("Rulebook post created. Visit it to view.");
      context.ui.navigateTo(post);
    },
  });
}

function registerRunSweep(): void {
  Devvit.addMenuItem({
    label: "Memex: Run consistency sweep",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      await context.scheduler.runJob({
        name: "consistencySweep",
        runAt: new Date(),
        data: { manual: true },
      });
      context.ui.showToast(
        "Consistency sweep started. Results will be posted to modmail.",
      );
    },
  });
}

function registerSendCalibrationDigest(): void {
  Devvit.addMenuItem({
    label: "Memex: Send calibration digest now",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      const shadows = await listShadowMods(context.redis);
      if (shadows.length === 0) {
        context.ui.showToast(
          "No shadow mods yet. Put a mod in shadow mode (or seed demo data) first.",
        );
        return;
      }
      await context.scheduler.runJob({
        name: "weeklyCalibrationDigest",
        runAt: new Date(),
      });
      context.ui.showToast(
        "Calibration digest started. Check modmail for each shadow mod with recent activity.",
      );
    },
  });
}

const seedForm = Devvit.createForm(
  {
    title: "Seed demo data",
    acceptLabel: "Inject decisions",
    description:
      "Resets to a fixed set of ~18 realistic past decisions (plus a calibration trail) so Decision DNA and the Living Rulebook show real patterns. Re-running replaces the demo set, never duplicates. For demos/testing only.",
    fields: [
      {
        name: "confirm",
        label: "Yes, inject demo decisions",
        type: "boolean",
        defaultValue: true,
      },
    ],
  },
  async (event, context) => {
    if (!event.values.confirm) {
      context.ui.showToast("Cancelled. No data injected.");
      return;
    }
    const { decisions, shadowMod } = await seedDemoData(context);
    context.ui.showToast(
      shadowMod
        ? `Injected ${decisions} decisions + a calibration trail. You're now a demo shadow mod: run "Send calibration digest now", then graduate via "Toggle shadow mode".`
        : `Injected ${decisions} demo decisions. Try Decision DNA on similar content.`,
    );
  },
);

function registerSeedDemo(): void {
  Devvit.addMenuItem({
    label: "Memex: Seed demo data (testing)",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      context.ui.showForm(seedForm);
    },
  });
}

function registerClearDemo(): void {
  Devvit.addMenuItem({
    label: "Memex: Clear demo data (testing)",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      const removed = await clearDemoData(context);
      context.ui.showToast(
        `Cleared ${removed} seeded decision${removed === 1 ? "" : "s"} and reset demo shadow/calibration. Real decisions kept.`,
      );
    },
  });
}

export function registerMenu(): void {
  registerSendToConclave();
  registerDecisionDNA();
  registerRunSweep();
  registerSendCalibrationDigest();
  registerSeedDemo();
  registerClearDemo();
  registerToggleShadow();
  registerOpenRulebook();
}
