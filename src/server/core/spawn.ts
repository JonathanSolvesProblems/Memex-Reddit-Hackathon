import { reddit } from "@devvit/web/server";
import type { Conclave, TargetKind } from "../../shared/types";
import { getConclaveByTarget, markTargetRouted, saveConclave } from "./redis";
import type { QuorumSettings } from "./settings";

const HOUR_MS = 60 * 60 * 1000;

export type SpawnInput = {
  subredditName: string;
  targetKind: TargetKind;
  targetId: string;
  authorName: string;
  contentSnippet: string;
  permalink: string;
  openedBy: string;
  reason: string;
};

export type SpawnResult = {
  conclave?: Conclave;
  alreadyExisted: boolean;
  conclavePostUrl?: string;
  postId?: string;
};

/**
 * Creates a Conclave decision room. On Devvit Web there is a single custom-post
 * type that renders the React client; the client routes to the Conclave view by
 * looking up the conclave-by-post mapping we persist here. (One-off close timing
 * is handled by the periodic conclave-sweep cron rather than a per-room job.)
 */
export async function spawnConclave(
  input: SpawnInput,
  settings: QuorumSettings,
): Promise<SpawnResult> {
  const existing = await getConclaveByTarget(input.targetId);
  if (existing) return { conclave: existing, alreadyExisted: true };

  const now = Date.now();
  const conclaveId = `c_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const conclave: Conclave = {
    id: conclaveId,
    subredditName: input.subredditName,
    targetKind: input.targetKind,
    targetId: input.targetId,
    authorName: input.authorName,
    contentSnippet: truncate(input.contentSnippet, 1000),
    permalink: input.permalink,
    openedAt: now,
    closesAt: now + settings.voteWindowHours * HOUR_MS,
    openedBy: input.openedBy,
    reason: input.reason,
    closed: false,
  };

  const post = await reddit.submitCustomPost({
    title: `[Memex] Decision needed: ${input.targetKind} by u/${input.authorName}`,
  });

  conclave.conclavePostId = post.id;
  await saveConclave(conclave);
  await markTargetRouted(input.targetId);

  try {
    const sub = await reddit.getSubredditByName(input.subredditName);
    await reddit.modMail.createModInboxConversation({
      subredditId: sub.id,
      subject: `[Memex] New decision needed (${conclaveId})`,
      bodyMarkdown:
        `A new Conclave is open for [this ${input.targetKind}](${input.permalink}) by u/${input.authorName}.\n\n` +
        `Routing reason: ${input.reason}\n\n` +
        `Cast your vote here: ${post.permalink}\n\n` +
        `Votes needed: ${settings.quorumSize}. Window: ${settings.voteWindowHours}h.`,
    });
  } catch {
    // best-effort
  }

  return {
    conclave,
    alreadyExisted: false,
    conclavePostUrl: post.permalink,
    postId: post.id,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
