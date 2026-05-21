import type {
  AppInstall,
  AppUpgrade,
  CommentSubmit,
  ModAction,
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
import { recordDecision } from "./precedent/retrieve.js";
import { getConclave, K, wasRouted } from "./redis.js";
import { loadSettings } from "./settings.js";
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
