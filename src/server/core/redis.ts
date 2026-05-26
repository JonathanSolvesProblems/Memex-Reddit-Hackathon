import { redis } from "@devvit/web/server";
import type {
  Conclave,
  Vote,
  Precedent,
  CalibrationRecord,
  VoteChoice,
} from "../../shared/types";

export const K = {
  conclave: (id: string) => `conclave:${id}`,
  conclaveByTarget: (targetId: string) => `conclave-by-target:${targetId}`,
  conclaveByPost: (postId: string) => `conclave-by-post:${postId}`,
  openConclaves: () => "conclave:open",
  conclavesIndex: () => "conclave:index",

  vote: (conclaveId: string, modName: string) =>
    `vote:${conclaveId}:${modName}`,
  votesByConclave: (conclaveId: string) => `votes:${conclaveId}`,

  precedent: (id: string) => `precedent:${id}`,
  precedentIndex: () => "precedent:index",
  precedentTokens: (id: string) => `precedent:tokens:${id}`,
  precedentEmbed: (id: string) => `precedent:embed:${id}`,

  calibration: (modName: string) => `calibration:${modName}`,
  calibrationMods: () => "calibration:mods",
  shadowMods: () => "shadow-mods",

  routedTargets: () => "routed-targets",
  viewing: (conclaveId: string) => `viewing:${conclaveId}`,
  sweepReported: () => "sweep-reported",
  rulebookPost: (postId: string) => `rulebook-post:${postId}`,
  rulebookCurrent: () => "rulebook:current",
};

const VIEW_WINDOW_MS = 6_000;

/** Records that a mod is currently viewing a conclave (Redis-backed presence). */
export async function touchViewer(
  conclaveId: string,
  modName: string,
): Promise<void> {
  await redis.zAdd(K.viewing(conclaveId), {
    member: modName,
    score: Date.now(),
  });
}

/** Distinct mods who pinged within the presence window. */
export async function countActiveViewers(conclaveId: string): Promise<number> {
  const now = Date.now();
  const cutoff = now - VIEW_WINDOW_MS;
  await redis.zRemRangeByScore(K.viewing(conclaveId), 0, cutoff - 1);
  const entries = await redis.zRange(K.viewing(conclaveId), cutoff, now, {
    by: "score",
  });
  return new Set(entries.map((e) => e.member)).size;
}

export async function saveConclave(conclave: Conclave): Promise<void> {
  await redis.set(K.conclave(conclave.id), JSON.stringify(conclave));
  await redis.set(K.conclaveByTarget(conclave.targetId), conclave.id);
  if (conclave.conclavePostId) {
    await redis.set(K.conclaveByPost(conclave.conclavePostId), conclave.id);
  }
  if (!conclave.closed) {
    await redis.zAdd(K.openConclaves(), {
      member: conclave.id,
      score: conclave.closesAt,
    });
  } else {
    await redis.zRem(K.openConclaves(), [conclave.id]);
  }
  await redis.zAdd(K.conclavesIndex(), {
    member: conclave.id,
    score: conclave.openedAt,
  });
}

export async function getConclave(id: string): Promise<Conclave | undefined> {
  const raw = await redis.get(K.conclave(id));
  if (!raw) return undefined;
  return JSON.parse(raw) as Conclave;
}

export async function getConclaveByTarget(
  targetId: string,
): Promise<Conclave | undefined> {
  const id = await redis.get(K.conclaveByTarget(targetId));
  if (!id) return undefined;
  return getConclave(id);
}

export async function getConclaveByPost(
  postId: string,
): Promise<Conclave | undefined> {
  const id = await redis.get(K.conclaveByPost(postId));
  if (!id) return undefined;
  return getConclave(id);
}

export async function listOpenConclaves(before: number): Promise<string[]> {
  const entries = await redis.zRange(K.openConclaves(), 0, before, {
    by: "score",
  });
  return entries.map((e) => e.member);
}

export async function castVote(vote: Vote): Promise<void> {
  await redis.set(K.vote(vote.conclaveId, vote.modName), JSON.stringify(vote));
  await redis.hSet(K.votesByConclave(vote.conclaveId), {
    [vote.modName]: JSON.stringify(vote),
  });
}

export async function getVotes(conclaveId: string): Promise<Vote[]> {
  const raw = await redis.hGetAll(K.votesByConclave(conclaveId));
  if (!raw) return [];
  return Object.values(raw).map((v) => JSON.parse(v) as Vote);
}

export async function savePrecedent(
  precedent: Precedent,
  tokens: string[],
): Promise<void> {
  await redis.set(K.precedent(precedent.id), JSON.stringify(precedent));
  await redis.set(K.precedentTokens(precedent.id), tokens.join(" "));
  await redis.zAdd(K.precedentIndex(), {
    member: precedent.id,
    score: precedent.decidedAt,
  });
}

/** Stores the optional semantic embedding for a precedent (best-effort layer). */
export async function savePrecedentEmbedding(
  id: string,
  vector: number[],
): Promise<void> {
  await redis.set(K.precedentEmbed(id), JSON.stringify(vector));
}

export async function getPrecedent(id: string): Promise<Precedent | undefined> {
  const raw = await redis.get(K.precedent(id));
  if (!raw) return undefined;
  return JSON.parse(raw) as Precedent;
}

/** Batched fetch of precedents by id (one Redis round-trip), order preserved. */
export async function getPrecedentsByIds(ids: string[]): Promise<Precedent[]> {
  if (ids.length === 0) return [];
  const raws = await redis.mGet(ids.map(K.precedent));
  const out: Precedent[] = [];
  for (const raw of raws) {
    if (raw) out.push(JSON.parse(raw) as Precedent);
  }
  return out;
}

export async function recentPrecedentIds(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const entries = await redis.zRange(K.precedentIndex(), 0, limit - 1, {
    reverse: true,
    by: "rank",
  });
  return entries.map((e) => e.member);
}

export async function precedentCount(): Promise<number> {
  return redis.zCard(K.precedentIndex());
}

export async function precedentCountSince(since: number): Promise<number> {
  const entries = await redis.zRange(
    K.precedentIndex(),
    since,
    Number.MAX_SAFE_INTEGER,
    { by: "score" },
  );
  return entries.length;
}

export async function clearSeededPrecedents(): Promise<number> {
  const entries = await redis.zRange(
    K.precedentIndex(),
    0,
    Number.MAX_SAFE_INTEGER,
    { by: "rank" },
  );
  const seeded = entries
    .map((e) => e.member)
    .filter((id) => id.startsWith("seed_"));
  for (const id of seeded) {
    await redis.del(K.precedent(id));
    await redis.del(K.precedentTokens(id));
    await redis.del(K.precedentEmbed(id));
    await redis.zRem(K.precedentIndex(), [id]);
  }
  return seeded.length;
}

export async function clearSeededCalibration(modName: string): Promise<void> {
  const raw = await redis.hGetAll(K.calibration(modName));
  if (!raw) return;
  const fields = Object.keys(raw).filter((f) => f.startsWith("seed_calib_"));
  if (fields.length > 0) await redis.hDel(K.calibration(modName), fields);
}

export async function getPrecedentTokens(id: string): Promise<string[]> {
  const raw = await redis.get(K.precedentTokens(id));
  if (!raw) return [];
  return raw.split(" ").filter(Boolean);
}

export async function markTargetRouted(targetId: string): Promise<void> {
  await redis.zAdd(K.routedTargets(), { member: targetId, score: Date.now() });
}

export async function wasRouted(targetId: string): Promise<boolean> {
  const score = await redis.zScore(K.routedTargets(), targetId);
  return score !== undefined && score !== null;
}

export async function wasSweepReported(itemId: string): Promise<boolean> {
  const score = await redis.zScore(K.sweepReported(), itemId);
  return score !== undefined && score !== null;
}

export async function markSweepReported(itemId: string): Promise<void> {
  await redis.zAdd(K.sweepReported(), { member: itemId, score: Date.now() });
}

export async function recordCalibration(
  record: CalibrationRecord,
): Promise<void> {
  await redis.hSet(K.calibration(record.modName), {
    [`${record.conclaveId}:${record.recordedAt}`]: JSON.stringify(record),
  });
  await redis.zAdd(K.calibrationMods(), {
    member: record.modName,
    score: Date.now(),
  });
}

export async function getCalibrationFor(
  modName: string,
): Promise<CalibrationRecord[]> {
  const raw = await redis.hGetAll(K.calibration(modName));
  if (!raw) return [];
  return Object.values(raw).map((v) => JSON.parse(v) as CalibrationRecord);
}

export async function isShadowMod(modName: string): Promise<boolean> {
  const raw = await redis.hGet(K.shadowMods(), modName);
  return raw === "true";
}

export async function setShadowMod(
  modName: string,
  shadow: boolean,
): Promise<void> {
  if (shadow) {
    await redis.hSet(K.shadowMods(), { [modName]: "true" });
  } else {
    await redis.hDel(K.shadowMods(), [modName]);
  }
}

export async function listShadowMods(): Promise<string[]> {
  const raw = await redis.hGetAll(K.shadowMods());
  if (!raw) return [];
  return Object.entries(raw)
    .filter(([, v]) => v === "true")
    .map(([k]) => k);
}

export async function markRulebookPost(postId: string): Promise<void> {
  await redis.set(K.rulebookPost(postId), "1");
}

export async function isRulebookPost(postId: string): Promise<boolean> {
  return (await redis.get(K.rulebookPost(postId))) === "1";
}

/** Singleton pointer to the subreddit's current Living Rulebook post, if any. */
export async function setCurrentRulebookPost(postId: string): Promise<void> {
  await redis.set(K.rulebookCurrent(), postId);
}

export async function getCurrentRulebookPost(): Promise<string | undefined> {
  return (await redis.get(K.rulebookCurrent())) ?? undefined;
}

export function tallyVotes(votes: Vote[]): {
  remove: number;
  keep: number;
  warn: number;
  escalate: number;
  total: number;
  winner?: VoteChoice;
} {
  const counts: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  let total = 0;
  for (const v of votes) {
    if (v.shadow) continue;
    counts[v.choice] += 1;
    total += 1;
  }
  const winner = pluralityWinner(counts);
  return { ...counts, total, winner };
}

/**
 * Order-independent plurality: returns the single leading choice, or undefined
 * if there are no votes or two-or-more choices tie for the lead.
 */
export function pluralityWinner(
  counts: Record<VoteChoice, number>,
): VoteChoice | undefined {
  const choices: VoteChoice[] = ["remove", "keep", "warn", "escalate"];
  let max = 0;
  for (const c of choices) if (counts[c] > max) max = counts[c];
  if (max === 0) return undefined;
  const leaders = choices.filter((c) => counts[c] === max);
  return leaders.length === 1 ? leaders[0] : undefined;
}
