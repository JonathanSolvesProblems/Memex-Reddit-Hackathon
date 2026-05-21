import { Devvit } from "@devvit/public-api";
import type { Context, MenuItemOnPressEvent } from "@devvit/public-api";
import { spawnConclave } from "./conclave/spawn.js";
import { findPrecedents, summarizeMatches } from "./precedent/retrieve.js";
import {
  isShadowMod,
  setShadowMod,
} from "./redis.js";
import { loadSettings } from "./settings.js";

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
      {
        name: "targetId",
        label: "Target ID (do not edit)",
        type: "string",
        required: true,
      },
      {
        name: "targetKind",
        label: "Target kind (do not edit)",
        type: "string",
        required: true,
      },
    ],
  },
  async (event, context) => {
    const reason = String(event.values.reason ?? "");
    const targetId = String(event.values.targetId);
    const targetKind = String(event.values.targetKind) as "post" | "comment";
    await openConclaveFor(context, targetId, targetKind, reason);
  },
);

async function openConclaveFor(
  context: Context,
  targetId: string,
  targetKind: "post" | "comment",
  reason: string,
): Promise<void> {
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
    contentSnippet = `${post.title}\n${(post as unknown as { body?: string }).body ?? ""}`;
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
    context.ui.showToast("A Conclave is already open for this item.");
    return;
  }
  context.ui.showToast("Conclave opened. Notified team via modmail.");
  if (result.conclavePostUrl) {
    context.ui.navigateTo(result.conclavePostUrl);
  }
}

function registerSendToConclave(location: "post" | "comment"): void {
  Devvit.addMenuItem({
    label: "Quorum: Send to Conclave",
    location,
    forUserType: "moderator",
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const targetId =
        location === "post" ? event.targetId : event.targetId;
      if (!targetId) {
        context.ui.showToast("Could not determine target.");
        return;
      }
      context.ui.showForm(reasonForm, {
        targetId,
        targetKind: location,
      });
    },
  });
}

function registerShowPrecedents(location: "post" | "comment"): void {
  Devvit.addMenuItem({
    label: "Quorum: Show similar past decisions",
    location,
    forUserType: "moderator",
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const targetId = event.targetId;
      if (!targetId) {
        context.ui.showToast("Could not determine target.");
        return;
      }
      let snippet = "";
      if (location === "post") {
        const post = await context.reddit.getPostById(targetId);
        snippet = `${post.title}\n${(post as unknown as { body?: string }).body ?? ""}`;
      } else {
        const comment = await context.reddit.getCommentById(targetId);
        snippet = comment.body;
      }
      const settings = await loadSettings(context);
      const matches = await findPrecedents(context, snippet, {
        limit: settings.precedentLimit,
        minSimilarity: settings.precedentMinSimilarity,
        topK: 3,
      });
      const body = summarizeMatches(matches);

      const sub = await context.reddit.getCurrentSubreddit();
      try {
        await context.reddit.modMail.createModInboxConversation({
          subredditId: sub.id,
          subject: `[Quorum] Precedents for ${location}`,
          bodyMarkdown: body,
        });
        context.ui.showToast("Precedents posted to modmail.");
      } catch {
        context.ui.showToast("Could not post to modmail.");
      }
    },
  });
}

function registerToggleShadow(): void {
  Devvit.addMenuItem({
    label: "Quorum: Toggle shadow mode for a mod",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      context.ui.showForm(toggleShadowForm);
    },
  });
}

const toggleShadowForm = Devvit.createForm(
  {
    title: "Toggle shadow mode",
    acceptLabel: "Apply",
    fields: [
      {
        name: "username",
        label: "Mod username (without u/)",
        type: "string",
        required: true,
      },
      {
        name: "enable",
        label: "Enable shadow mode (uncheck to graduate to full vote)",
        type: "boolean",
        defaultValue: true,
      },
    ],
  },
  async (event, context) => {
    const username = String(event.values.username).replace(/^u\//, "").trim();
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
    label: "Quorum: Open Living Rulebook",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event, context) => {
      const sub = await context.reddit.getCurrentSubreddit();
      const post = await context.reddit.submitPost({
        title: "Quorum — Living Rulebook",
        subredditName: sub.name,
        preview: (
          <vstack alignment="middle center" grow padding="medium">
            <text size="medium">Loading the team's decision history…</text>
          </vstack>
        ),
      });
      await context.redis.set(`rulebook-post:${post.id}`, "1");
      context.ui.showToast("Rulebook post created. Visit it to view.");
      context.ui.navigateTo(post.permalink);
    },
  });
}

export function registerMenu(): void {
  registerSendToConclave("post");
  registerSendToConclave("comment");
  registerShowPrecedents("post");
  registerShowPrecedents("comment");
  registerToggleShadow();
  registerOpenRulebook();
}
