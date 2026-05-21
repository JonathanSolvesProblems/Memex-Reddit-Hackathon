import type { RedisClient } from "@devvit/public-api";
import type {
  Conclave,
  Vote,
  Precedent,
  CalibrationRecord,
  VoteChoice,
} from "./types.js";

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

  calibration: (modName: string) => `calibration:${modName}`,
  calibrationMods: () => "calibration:mods",
  shadowMods: () => "shadow-mods",

  routedTargets: () => "routed-targets",
};

export async function saveConclave(
  redis: RedisClient,
  conclave: Conclave,
): Promise<void> {
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

export async function getConclave(
  redis: RedisClient,
  id: string,
): Promise<Conclave | undefined> {
  const raw = await redis.get(K.conclave(id));
  if (!raw) return undefined;
  return JSON.parse(raw) as Conclave;
}

export async function getConclaveByTarget(
  redis: RedisClient,
  targetId: string,
): Promise<Conclave | undefined> {
  const id = await redis.get(K.conclaveByTarget(targetId));
  if (!id) return undefined;
  return getConclave(redis, id);
}

export async function listOpenConclaves(
  redis: RedisClient,
  before: number,
): Promise<string[]> {
  const entries = await redis.zRange(K.openConclaves(), 0, before, {
    by: "score",
  });
  return entries.map((e) => e.member);
}

export async function castVote(
  redis: RedisClient,
  vote: Vote,
): Promise<void> {
  await redis.set(K.vote(vote.conclaveId, vote.modName), JSON.stringify(vote));
  await redis.hSet(K.votesByConclave(vote.conclaveId), {
    [vote.modName]: JSON.stringify(vote),
  });
}

export async function getVotes(
  redis: RedisClient,
  conclaveId: string,
): Promise<Vote[]> {
  const raw = await redis.hGetAll(K.votesByConclave(conclaveId));
  if (!raw) return [];
  return Object.values(raw).map((v) => JSON.parse(v) as Vote);
}

export async function savePrecedent(
  redis: RedisClient,
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

export async function getPrecedent(
  redis: RedisClient,
  id: string,
): Promise<Precedent | undefined> {
  const raw = await redis.get(K.precedent(id));
  if (!raw) return undefined;
  return JSON.parse(raw) as Precedent;
}

export async function recentPrecedentIds(
  redis: RedisClient,
  limit: number,
): Promise<string[]> {
  const now = Date.now();
  const entries = await redis.zRange(K.precedentIndex(), 0, now, {
    by: "score",
  });
  return entries
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.member);
}

export async function getPrecedentTokens(
  redis: RedisClient,
  id: string,
): Promise<string[]> {
  const raw = await redis.get(K.precedentTokens(id));
  if (!raw) return [];
  return raw.split(" ").filter(Boolean);
}

export async function markTargetRouted(
  redis: RedisClient,
  targetId: string,
): Promise<void> {
  await redis.zAdd(K.routedTargets(), {
    member: targetId,
    score: Date.now(),
  });
}

export async function wasRouted(
  redis: RedisClient,
  targetId: string,
): Promise<boolean> {
  const score = await redis.zScore(K.routedTargets(), targetId);
  return score !== undefined && score !== null;
}

export async function recordCalibration(
  redis: RedisClient,
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
  redis: RedisClient,
  modName: string,
): Promise<CalibrationRecord[]> {
  const raw = await redis.hGetAll(K.calibration(modName));
  if (!raw) return [];
  return Object.values(raw).map((v) => JSON.parse(v) as CalibrationRecord);
}

export async function isShadowMod(
  redis: RedisClient,
  modName: string,
): Promise<boolean> {
  const raw = await redis.hGet(K.shadowMods(), modName);
  return raw === "true";
}

export async function setShadowMod(
  redis: RedisClient,
  modName: string,
  shadow: boolean,
): Promise<void> {
  if (shadow) {
    await redis.hSet(K.shadowMods(), { [modName]: "true" });
  } else {
    await redis.hDel(K.shadowMods(), [modName]);
  }
}

export async function listShadowMods(
  redis: RedisClient,
): Promise<string[]> {
  const raw = await redis.hGetAll(K.shadowMods());
  if (!raw) return [];
  return Object.entries(raw)
    .filter(([, v]) => v === "true")
    .map(([k]) => k);
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
  let winner: VoteChoice | undefined;
  let max = 0;
  for (const c of ["remove", "keep", "warn", "escalate"] as VoteChoice[]) {
    if (counts[c] > max) {
      max = counts[c];
      winner = c;
    } else if (counts[c] === max && winner && c !== winner) {
      winner = undefined;
    }
  }
  return { ...counts, total, winner };
}
