import type {
  AppInstall,
  AppUpgrade,
  CommentSubmit,
  ModAction,
  ModMail,
  PostSubmit,
} from "@devvit/protos";
import type {
  JobContext,
  JSONObject,
  ScheduledJobEvent,
  TriggerContext,
} from "@devvit/public-api";
import {
  evaluateAutoRoute,
  getAuthorCreatedAt,
} from "./conclave/router.js";
import { spawnConclave } from "./conclave/spawn.js";
import { closeExpired } from "./conclave/vote.js";
import {
  analyzeDecision,
  formatDecisionDNA,
  recordDecision,
} from "./precedent/retrieve.js";
import { getConclave, K, wasRouted } from "./redis.js";
import { loadSettings } from "./settings.js";
import { runOnboarding } from "./onboard.js";
import type { ModAction as QuorumModAction, VoteChoice } from "./types.js";

const REMOVE_ACTIONS = new Set<QuorumModAction>([
  "removelink",
  "removecomment",
  "spamlink",
  "spamcomment",
]);
const APPROVE_ACTIONS = new Set<QuorumModAction>([
  "approvelink",
  "approvecomment",
]);

export async function onPostSubmit(
  event: PostSubmit,
  context: TriggerContext,
): Promise<void> {
  if (!event.post || !event.author?.name) return;
  const settings = await loadSettings(context);
  if (!settings.autoRouteEnabled) return;

  const decision = evaluateAutoRoute(
    {
      contentText: `${event.post.title ?? ""}\n${event.post.selftext ?? ""}`,
      authorName: event.author.name,
      reportCount: 0,
      authorCreatedAt: await getAuthorCreatedAt(context, event.author.name),
    },
    settings,
    { ignoreReports: true },
  );
  if (!decision.route) return;
  if (await wasRouted(context.redis, event.post.id)) return;

  const sub =
    event.subreddit?.name ?? (await context.reddit.getCurrentSubredditName());
  await spawnConclave(
    context,
    {
      subredditName: sub,
      targetKind: "post",
      targetId: event.post.id,
      authorName: event.author.name,
      contentSnippet:
        `${event.post.title ?? ""}\n${event.post.selftext ?? ""}`.trim(),
      permalink: event.post.permalink ?? "",
      openedBy: "auto-router",
      reason: decision.reason,
    },
    settings,
  );
}

export async function onCommentSubmit(
  event: CommentSubmit,
  context: TriggerContext,
): Promise<void> {
  if (!event.comment || !event.author?.name) return;
  const settings = await loadSettings(context);
  if (!settings.autoRouteEnabled) return;
  if (settings.autoRouteKeywords.length === 0) return;
  const text = event.comment.body ?? "";
  const matchedKw = settings.autoRouteKeywords.find((k) =>
    text.toLowerCase().includes(k),
  );
  if (!matchedKw) return;
  if (await wasRouted(context.redis, event.comment.id)) return;

  const sub =
    event.subreddit?.name ?? (await context.reddit.getCurrentSubredditName());
  await spawnConclave(
    context,
    {
      subredditName: sub,
      targetKind: "comment",
      targetId: event.comment.id,
      authorName: event.author.name,
      contentSnippet: text.trim(),
      permalink: event.comment.permalink ?? "",
      openedBy: "auto-router",
      reason: `keyword match: "${matchedKw}"`,
    },
    settings,
  );
}

export async function onModActionEvent(
  event: ModAction,
  context: TriggerContext,
): Promise<void> {
  const action = event.action as QuorumModAction | undefined;
  if (!action) return;

  let voteAction: VoteChoice | undefined;
  if (REMOVE_ACTIONS.has(action)) voteAction = "remove";
  else if (APPROVE_ACTIONS.has(action)) voteAction = "keep";
  if (!voteAction) return;

  const targetId = event.targetPost?.id ?? event.targetComment?.id;
  if (!targetId) return;
  const targetKind = event.targetPost?.id ? "post" : "comment";

  if (await isQuorumOriginated(context, targetId)) {
    return;
  }

  const modName = event.moderator?.name ?? "unknown";
  if (modName === context.appName) return;

  const snippet =
    event.targetPost?.title ?? event.targetComment?.body ?? "";
  if (!snippet) return;

  const permalink = event.targetPost?.permalink ?? event.targetComment?.permalink ?? "";
  const sub = event.subreddit?.name ?? (await context.reddit.getCurrentSubredditName());

  await recordDecision(context.redis, {
    id: `solo_${targetId}`,
    subredditName: sub,
    targetKind,
    contentSnippet: snippet,
    action: voteAction,
    modName,
    reason: "",
    permalink,
    decidedAt: Date.now(),
  });
}

async function isQuorumOriginated(
  context: TriggerContext,
  targetId: string,
): Promise<boolean> {
  const conclaveId = await context.redis.get(K.conclaveByTarget(targetId));
  if (!conclaveId) return false;
  const conclave = await getConclave(context.redis, conclaveId);
  return !!conclave && conclave.closed;
}

export async function onAppInstallOrUpgrade(
  _event: AppInstall | AppUpgrade,
  context: TriggerContext,
): Promise<void> {
  const existing = await context.scheduler.listJobs();
  for (const job of existing) {
    try {
      await context.scheduler.cancelJob(job.id);
    } catch {
      // ignore
    }
  }

  const randomMinute = Math.floor(Math.random() * 60);
  await context.scheduler.runJob({
    name: "weeklyCalibrationDigest",
    cron: `${randomMinute} 14 * * 1`,
  });

  await context.scheduler.runJob({
    name: "conclaveSweep",
    cron: `*/15 * * * *`,
  });

  await runOnboarding(context);
}

export async function onConclaveTimeout(
  event: ScheduledJobEvent<JSONObject | undefined>,
  context: JobContext,
): Promise<void> {
  const conclaveId = event.data?.conclaveId as string | undefined;
  if (!conclaveId) return;
  const conclave = await getConclave(context.redis, conclaveId);
  if (!conclave) return;
  const settings = await loadSettings(context);
  await closeExpired(context, conclave, settings);
}

export async function onConclaveSweep(
  _event: ScheduledJobEvent<JSONObject | undefined>,
  context: JobContext,
): Promise<void> {
  const now = Date.now();
  const settings = await loadSettings(context);
  const expiredIds = await context.redis.zRange(K.openConclaves(), 0, now, {
    by: "score",
  });
  for (const entry of expiredIds) {
    const conclave = await getConclave(context.redis, entry.member);
    if (!conclave) continue;
    await closeExpired(context, conclave, settings);
  }
}

const APPEAL_ASSIST_TTL_DAYS = 30;

/**
 * Appeal assist: when a user writes into modmail (e.g. a removal/ban appeal),
 * add an internal, mod-only note with the Decision DNA for that content so the
 * team can respond consistently. Best-effort and once per conversation.
 */
export async function onModMailReceived(
  event: ModMail,
  context: TriggerContext,
): Promise<void> {
  try {
    console.log(
      `[Memex appeal] event: authorType=${event.messageAuthorType} convType=${event.conversationType} auto=${event.isAutoGenerated} conv=${event.conversationId}`,
    );
    // Devvit serializes this enum as e.g. "ParticipatingAs_PARTICIPANT_USER".
    // Act only on messages authored by a non-mod end user (not the app/mods).
    if (!event.messageAuthorType.toUpperCase().includes("PARTICIPANT_USER")) {
      console.log(
        `[Memex appeal] skip: author type "${event.messageAuthorType}" is not a participant user`,
      );
      return;
    }
    if (!event.conversationType.toLowerCase().includes("sr_user")) {
      console.log(
        `[Memex appeal] skip: conversation type "${event.conversationType}" is not sr_user`,
      );
      return;
    }
    if (event.isAutoGenerated) {
      console.log("[Memex appeal] skip: auto-generated message");
      return;
    }
    const conversationId = event.conversationId;
    if (!conversationId) return;

    const flagKey = `appeal-assisted:${conversationId}`;
    if (await context.redis.get(flagKey)) {
      console.log("[Memex appeal] skip: already assisted this conversation");
      return;
    }

    const { conversation } = await context.reddit.modMail.getConversation({
      conversationId,
      markRead: false,
    });
    const messages = conversation?.messages ?? {};
    const text = Object.values(messages)
      .map((m) => {
        const msg = m as { bodyMarkdown?: string; body?: string };
        return msg.bodyMarkdown ?? msg.body ?? "";
      })
      .join("\n")
      .slice(0, 2000);
    if (!text.trim()) {
      console.log("[Memex appeal] skip: no message text found");
      return;
    }

    const settings = await loadSettings(context);
    const analysis = await analyzeDecision(context, text, {
      limit: settings.precedentLimit,
      minSimilarity: settings.precedentMinSimilarity,
      topK: 3,
    });
    console.log(
      `[Memex appeal] analysis: considered=${analysis.consideredCount} dominant=${analysis.dominant ?? "none"}`,
    );
    if (analysis.consideredCount === 0) {
      console.log(
        "[Memex appeal] skip: no similar past decisions matched the message",
      );
      return;
    }

    await context.redis.set(flagKey, "1", {
      expiration: new Date(
        Date.now() + APPEAL_ASSIST_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
    });

    await context.reddit.modMail.reply({
      conversationId,
      isInternal: true,
      body:
        "**🧬 Memex appeal context** (mod-only)\n\n" +
        formatDecisionDNA(analysis) +
        "\n\n_Auto-added by Memex to help the team respond consistently._",
    });
    console.log("[Memex appeal] internal note added to conversation");
  } catch (e) {
    console.error(
      "[Memex appeal] error:",
      e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    );
  }
}
