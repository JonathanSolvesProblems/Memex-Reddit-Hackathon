import { context, reddit } from "@devvit/web/server";
import { T1, T3 } from "@devvit/web/shared";
import type { Conclave, Vote, VoteChoice } from "../../shared/types";
import {
  castVote,
  getConclave,
  getVotes,
  isShadowMod,
  recordCalibration,
  saveConclave,
  tallyVotes,
} from "./redis";
import { recordDecision } from "./retrieve";
import type { QuorumSettings } from "./settings";

export type CastVoteInput = {
  conclaveId: string;
  modName: string;
  choice: VoteChoice;
  reason: string;
};

export async function submitVote(
  input: CastVoteInput,
  settings: QuorumSettings,
): Promise<{ ok: boolean; message: string; resolved?: VoteChoice }> {
  const conclave = await getConclave(input.conclaveId);
  if (!conclave) return { ok: false, message: "Conclave not found." };
  if (conclave.closed) {
    return { ok: false, message: "Voting on this conclave is closed." };
  }

  const shadow = await isShadowMod(input.modName);
  const vote: Vote = {
    conclaveId: input.conclaveId,
    modName: input.modName,
    choice: input.choice,
    reason: input.reason.slice(0, 200),
    shadow,
    castAt: Date.now(),
  };
  await castVote(vote);

  const votes = await getVotes(input.conclaveId);
  const tally = tallyVotes(votes);

  if (tally.total >= settings.quorumSize && tally.winner) {
    const resolved = await resolveConclave(
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
  conclave: Conclave,
  resolution: VoteChoice,
  votes: Vote[],
  settings: QuorumSettings,
): Promise<VoteChoice> {
  if (conclave.closed) return conclave.resolution ?? resolution;

  // Persist closed=true BEFORE executing the mod action, so the ModAction
  // trigger's quorum guard sees the closed flag and never double-records.
  conclave.closed = true;
  conclave.resolution = resolution;
  await saveConclave(conclave);

  // Executing the action is best-effort: the target may have been deleted or
  // already actioned. The team's DECISION is real and must still be recorded.
  try {
    await executeResolution(conclave, resolution, settings);
  } catch (e) {
    console.error(
      "[Memex] executeResolution failed (recording decision anyway):",
      e instanceof Error ? e.message : String(e),
    );
  }

  const topReason = pickTopReason(votes, resolution);
  await recordDecision({
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

  await logCalibration(conclave, resolution, votes);
  await writeModNote(conclave, resolution, topReason);
  return resolution;
}

const NOTE_LABEL: Partial<
  Record<VoteChoice, "SPAM_WARNING" | "SOLID_CONTRIBUTOR">
> = {
  remove: "SPAM_WARNING",
  keep: "SOLID_CONTRIBUTOR",
};

/** Extends Memex's memory into Reddit's native mod-note timeline. Best-effort. */
async function writeModNote(
  conclave: Conclave,
  resolution: VoteChoice,
  reason: string,
): Promise<void> {
  if (!conclave.authorName || conclave.authorName === "unknown") return;
  const note =
    `[Memex] Team ${resolution.toUpperCase()} on ${conclave.targetKind}` +
    (reason ? `: ${reason}` : "");
  try {
    await reddit.addModNote({
      subreddit: conclave.subredditName,
      user: conclave.authorName,
      note: note.slice(0, 100),
      label: NOTE_LABEL[resolution],
    });
    console.log(`[Memex modnote] added note on u/${conclave.authorName}`);
  } catch (e) {
    console.error(
      "[Memex modnote] failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function executeResolution(
  conclave: Conclave,
  resolution: VoteChoice,
  settings: QuorumSettings,
): Promise<void> {
  switch (resolution) {
    case "remove":
      return removeTarget(conclave);
    case "keep":
      return approveTarget(conclave);
    case "warn":
      return warnAuthor(conclave);
    case "escalate":
      return notifyEscalation(conclave, settings);
  }
}

async function removeTarget(conclave: Conclave): Promise<void> {
  if (conclave.targetKind === "post") {
    const post = await reddit.getPostById(T3(conclave.targetId));
    await post.remove(false);
  } else {
    const comment = await reddit.getCommentById(T1(conclave.targetId));
    await comment.remove(false);
  }
}

async function approveTarget(conclave: Conclave): Promise<void> {
  if (conclave.targetKind === "post") {
    const post = await reddit.getPostById(T3(conclave.targetId));
    await post.approve();
  } else {
    const comment = await reddit.getCommentById(T1(conclave.targetId));
    await comment.approve();
  }
}

async function warnAuthor(conclave: Conclave): Promise<void> {
  try {
    await reddit.modMail.createModInboxConversation({
      subredditId: context.subredditId,
      subject: `[Memex] Warning issued: ${conclave.targetKind}`,
      bodyMarkdown:
        `The mod team reached quorum to warn u/${conclave.authorName} ` +
        `regarding [this ${conclave.targetKind}](${conclave.permalink}).\n\n` +
        `No removal was performed; please follow up via modmail to the user if needed.`,
    });
  } catch {
    // best-effort
  }
}

async function notifyEscalation(
  conclave: Conclave,
  settings: QuorumSettings,
): Promise<void> {
  const banLine = settings.banRequiresHumanClick
    ? "\n\n**Ban recommendation requires a human click** (per 2026 Reddit admin policy on ban bots). A senior mod should review this conclave and execute the ban manually if appropriate."
    : "";
  try {
    await reddit.modMail.createModInboxConversation({
      subredditId: context.subredditId,
      subject: `[Memex] Escalation: ${conclave.targetKind} by u/${conclave.authorName}`,
      bodyMarkdown:
        `The mod team reached quorum to **escalate** [this ${conclave.targetKind}](${conclave.permalink}).` +
        banLine,
    });
  } catch {
    // best-effort
  }
}

function pickTopReason(votes: Vote[], resolution: VoteChoice): string {
  const matching = votes.filter((v) => v.choice === resolution && v.reason);
  if (matching.length === 0) return "";
  matching.sort((a, b) => a.castAt - b.castAt);
  return matching[0]?.reason ?? "";
}

async function logCalibration(
  conclave: Conclave,
  resolution: VoteChoice,
  votes: Vote[],
): Promise<void> {
  for (const v of votes) {
    if (!v.shadow) continue;
    await recordCalibration({
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
  conclave: Conclave,
  settings: QuorumSettings,
): Promise<void> {
  if (conclave.closed) return;
  const votes = await getVotes(conclave.id);
  const tally = tallyVotes(votes);
  if (tally.winner && tally.total > 0) {
    await resolveConclave(conclave, tally.winner, votes, settings);
    return;
  }
  conclave.closed = true;
  await saveConclave(conclave);
}
