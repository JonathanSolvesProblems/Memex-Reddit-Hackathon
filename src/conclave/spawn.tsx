import { Devvit } from "@devvit/public-api";
import type { JSONObject, TriggerContext } from "@devvit/public-api";
import type { Conclave, TargetKind } from "../types.js";
import { getConclaveByTarget, markTargetRouted, saveConclave } from "../redis.js";
import type { QuorumSettings } from "../settings.js";

const HOUR_MS = 60 * 60 * 1000;

export interface SpawnInput {
  subredditName: string;
  targetKind: TargetKind;
  targetId: string;
  authorName: string;
  contentSnippet: string;
  permalink: string;
  openedBy: string;
  reason: string;
}

export async function spawnConclave(
  context: Pick<TriggerContext, "redis" | "reddit" | "scheduler">,
  input: SpawnInput,
  settings: QuorumSettings,
): Promise<{ conclave?: Conclave; alreadyExisted: boolean; conclavePostUrl?: string }> {
  const existing = await getConclaveByTarget(context.redis, input.targetId);
  if (existing) {
    return { conclave: existing, alreadyExisted: true };
  }

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

  const post = await context.reddit.submitPost({
    title: `[Quorum] Decision needed — ${input.targetKind} by u/${input.authorName}`,
    subredditName: input.subredditName,
    preview: (
      <vstack alignment="middle center" grow padding="medium">
        <text size="large" weight="bold">
          Loading Conclave…
        </text>
        <spacer size="small" />
        <text size="small" color="#8c8c8c">
          Mod-only decision room
        </text>
      </vstack>
    ),
  });

  conclave.conclavePostId = post.id;
  await saveConclave(context.redis, conclave);
  await markTargetRouted(context.redis, input.targetId);

  try {
    await context.reddit.modMail.createModInboxConversation({
      subredditId: post.subredditId,
      subject: `[Quorum] New decision needed (${conclaveId})`,
      bodyMarkdown:
        `A new Conclave is open for [this ${input.targetKind}](${input.permalink}) by u/${input.authorName}.\n\n` +
        `Routing reason: ${input.reason}\n\n` +
        `Cast your vote here: ${post.permalink}\n\n` +
        `Quorum: ${settings.quorumSize} votes. Window: ${settings.voteWindowHours}h.`,
    });
  } catch {
    // best-effort
  }

  await context.scheduler.runJob({
    name: "conclaveTimeout",
    runAt: new Date(conclave.closesAt + 60_000),
    data: { conclaveId } as JSONObject,
  });

  return {
    conclave,
    alreadyExisted: false,
    conclavePostUrl: post.permalink,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
