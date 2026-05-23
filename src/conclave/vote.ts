import type { Context, RedisClient, TriggerContext } from "@devvit/public-api";
import type { Conclave, Vote, VoteChoice } from "../types.js";
import {
  castVote,
  getConclave,
  getVotes,
  isShadowMod,
  recordCalibration,
  saveConclave,
  tallyVotes,
} from "../redis.js";
import { recordDecision } from "../precedent/retrieve.js";
import type { QuorumSettings } from "../settings.js";

export interface CastVoteInput {
  conclaveId: string;
  modName: string;
  choice: VoteChoice;
  reason: string;
}

export async function submitVote(
  context: Pick<TriggerContext, "redis" | "reddit" | "scheduler">,
  input: CastVoteInput,
  settings: QuorumSettings,
): Promise<{ ok: boolean; message: string; resolved?: VoteChoice }> {
  const conclave = await getConclave(context.redis, input.conclaveId);
  if (!conclave) return { ok: false, message: "Conclave not found." };
  if (conclave.closed) {
    return { ok: false, message: "Voting on this conclave is closed." };
  }

  const shadow = await isShadowMod(context.redis, input.modName);
  const vote: Vote = {
    conclaveId: input.conclaveId,
    modName: input.modName,
    choice: input.choice,
    reason: input.reason.slice(0, 200),
    shadow,
    castAt: Date.now(),
  };
  await castVote(context.redis, vote);

  const votes = await getVotes(context.redis, input.conclaveId);
  const tally = tallyVotes(votes);

  if (tally.total >= settings.quorumSize && tally.winner) {
    const resolved = await resolveConclave(
      context,
      conclave,
      tally.winner,
      votes,
      settings,
    );
    return {
      ok: true,
      message: shadow
        ? `Shadow vote recorded. Team reached quorum: ${resolved}.`
        : `Vote recorded. Quorum reached: ${resolved}.`,
      resolved,
    };
  }

  return {
    ok: true,
    message: shadow
      ? "Shadow vote recorded. It won't count toward quorum."
      : `Vote recorded (${tally.total}/${settings.quorumSize}).`,
  };
}

export async function resolveConclave(
  context: Pick<TriggerContext, "redis" | "reddit">,
  conclave: Conclave,
  resolution: VoteChoice,
  votes: Vote[],
  settings: QuorumSettings,
): Promise<VoteChoice> {
  if (conclave.closed) return conclave.resolution ?? resolution;

  // Persist closed=true BEFORE executing the mod action. The action fires the
  // ModAction trigger, whose isQuorumOriginated() guard checks the persisted
  // conclave.closed flag — if we executed first, the trigger could record a
  // duplicate "solo" precedent for the same decision.
  conclave.closed = true;
  conclave.resolution = resolution;
  await saveConclave(context.redis, conclave);
  await executeResolution(context, conclave, resolution, settings);

  const topReason = pickTopReason(votes, resolution);
  await recordDecision(context.redis, {
    id: conclave.id,
    subredditName: conclave.subredditName,
    targetKind: conclave.targetKind,
    contentSnippet: conclave.contentSnippet,
    action: resolution,
    modName: "team-consensus",
    reason: topReason,
    permalink: conclave.permalink,
    decidedAt: Date.now(),
  });

  await logCalibration(context.redis, conclave, resolution, votes);
  await writeModNote(context, conclave, resolution, topReason);
  return resolution;
}

const NOTE_LABEL: Partial<Record<VoteChoice, "SPAM_WARNING" | "SOLID_CONTRIBUTOR">> =
  {
    remove: "SPAM_WARNING",
    keep: "SOLID_CONTRIBUTOR",
  };

/**
 * Extends Memex's memory into Reddit's native mod-note timeline, so the team's
 * decision is visible even outside the app. Best-effort.
 */
async function writeModNote(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
  resolution: VoteChoice,
  reason: string,
): Promise<void> {
  if (!conclave.authorName || conclave.authorName === "unknown") return;
  const note =
    `[Memex] Team ${resolution.toUpperCase()} on ${conclave.targetKind}` +
    (reason ? `: ${reason}` : "");
  try {
    await context.reddit.addModNote({
      subreddit: conclave.subredditName,
      user: conclave.authorName,
      note: note.slice(0, 100),
      label: NOTE_LABEL[resolution],
    });
  } catch {
    // best-effort: app may lack permission, or user may be deleted
  }
}

async function executeResolution(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
  resolution: VoteChoice,
  settings: QuorumSettings,
): Promise<void> {
  switch (resolution) {
    case "remove":
      await removeTarget(context, conclave);
      return;
    case "keep":
      await approveTarget(context, conclave);
      return;
    case "warn":
      await warnAuthor(context, conclave);
      return;
    case "escalate":
      await notifyEscalation(context, conclave, settings);
      return;
  }
}

async function removeTarget(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
): Promise<void> {
  if (conclave.targetKind === "post") {
    const post = await context.reddit.getPostById(conclave.targetId);
    await post.remove(false);
  } else {
    const comment = await context.reddit.getCommentById(conclave.targetId);
    await comment.remove(false);
  }
}

async function approveTarget(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
): Promise<void> {
  if (conclave.targetKind === "post") {
    const post = await context.reddit.getPostById(conclave.targetId);
    await post.approve();
  } else {
    const comment = await context.reddit.getCommentById(conclave.targetId);
    await comment.approve();
  }
}

async function warnAuthor(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
): Promise<void> {
  try {
    await context.reddit.modMail.createModInboxConversation({
      subredditId: await getSubredditId(context, conclave.subredditName),
      subject: `[Memex] Warning issued — ${conclave.targetKind}`,
      bodyMarkdown:
        `The mod team reached quorum to warn u/${conclave.authorName} ` +
        `regarding [this ${conclave.targetKind}](${conclave.permalink}).\n\n` +
        `No removal was performed; please follow up via modmail to the user if needed.`,
    });
  } catch {
    // Surfacing to mods is best-effort; do not throw inside trigger.
  }
}

async function notifyEscalation(
  context: Pick<TriggerContext, "reddit">,
  conclave: Conclave,
  settings: QuorumSettings,
): Promise<void> {
  const banLine = settings.banRequiresHumanClick
    ? "\n\n**Ban recommendation requires a human click** (per 2026 Reddit admin policy on ban bots). A senior mod should review this conclave and execute the ban manually if appropriate."
    : "";
  try {
    await context.reddit.modMail.createModInboxConversation({
      subredditId: await getSubredditId(context, conclave.subredditName),
      subject: `[Memex] Escalation: ${conclave.targetKind} by u/${conclave.authorName}`,
      bodyMarkdown:
        `The mod team reached quorum to **escalate** [this ${conclave.targetKind}](${conclave.permalink}).` +
        banLine,
    });
  } catch {
    // best-effort
  }
}

async function getSubredditId(
  context: Pick<TriggerContext, "reddit">,
  name: string,
): Promise<string> {
  const sub = await context.reddit.getSubredditByName(name);
  return sub.id;
}

function pickTopReason(votes: Vote[], resolution: VoteChoice): string {
  const matching = votes.filter((v) => v.choice === resolution && v.reason);
  if (matching.length === 0) return "";
  matching.sort((a, b) => a.castAt - b.castAt);
  return matching[0].reason;
}

async function logCalibration(
  redis: RedisClient,
  conclave: Conclave,
  resolution: VoteChoice,
  votes: Vote[],
): Promise<void> {
  for (const v of votes) {
    if (!v.shadow) continue;
    await recordCalibration(redis, {
      modName: v.modName,
      conclaveId: conclave.id,
      shadowChoice: v.choice,
      teamChoice: resolution,
      agreed: v.choice === resolution,
      recordedAt: Date.now(),
    });
  }
}

export async function closeExpired(
  context: Pick<TriggerContext, "redis" | "reddit">,
  conclave: Conclave,
  settings: QuorumSettings,
): Promise<void> {
  if (conclave.closed) return;
  const votes = await getVotes(context.redis, conclave.id);
  const tally = tallyVotes(votes);
  if (tally.winner && tally.total > 0) {
    await resolveConclave(context, conclave, tally.winner, votes, settings);
    return;
  }
  conclave.closed = true;
  await saveConclave(context.redis, conclave);
}

export function uiVoteHandler(
  context: Context,
  conclaveId: string,
  choice: VoteChoice,
  reason: string,
  settings: QuorumSettings,
): () => Promise<void> {
  return async () => {
    const modName = (await context.reddit.getCurrentUser())?.username;
    if (!modName) {
      context.ui.showToast("Unable to identify current mod.");
      return;
    }
    const result = await submitVote(
      context,
      { conclaveId, modName, choice, reason },
      settings,
    );
    context.ui.showToast(result.message);
  };
}
