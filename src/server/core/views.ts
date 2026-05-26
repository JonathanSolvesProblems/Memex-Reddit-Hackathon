import type {
  ConclaveState,
  ConclaveSummary,
  PublicVote,
  RulebookData,
} from "../../shared/api";
import type { Conclave } from "../../shared/types";
import {
  countActiveViewers,
  getConclave,
  getPrecedentsByIds,
  getVotes,
  isShadowMod,
  listOpenConclaves,
  listShadowMods,
  precedentCount,
  precedentCountSince,
  recentPrecedentIds,
  tallyVotes,
} from "./redis";
import { analyzeDecision, formatDecisionDNA } from "./retrieve";
import { decisionsByDay, outcomeCounts } from "./stats";
import { loadSettings } from "./settings";
import { getSemanticConfig } from "./semantic";
import { SEED_DEMO_PROBES } from "./seed";
import type { QuorumSettings } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPARK_DAYS = 14;
const RULEBOOK_LOAD = 300;

function toPublicVotes(
  votes: Awaited<ReturnType<typeof getVotes>>,
): PublicVote[] {
  return votes
    .map((v) => ({
      modName: v.modName,
      choice: v.choice,
      reason: v.reason,
      shadow: v.shadow,
      castAt: v.castAt,
    }))
    .sort((a, b) => a.castAt - b.castAt);
}

/** Assembles the full live state for a Conclave decision room. */
export async function buildConclaveState(
  conclave: Conclave,
  username: string | undefined,
  settings?: QuorumSettings,
): Promise<ConclaveState> {
  const s = settings ?? (await loadSettings());
  const votes = await getVotes(conclave.id);
  const tally = tallyVotes(votes);
  const publicVotes = toPublicVotes(votes);
  const myVote = username
    ? publicVotes.find((v) => v.modName === username)
    : undefined;
  const isShadow = username ? await isShadowMod(username) : false;
  const viewers = await countActiveViewers(conclave.id);

  const analysis = await analyzeDecision(conclave.contentSnippet, {
    limit: s.precedentLimit,
    minSimilarity: s.precedentMinSimilarity,
    topK: 3,
    // Never let a conclave match itself or its own target's solo record.
    excludeTargetIds: [conclave.id, conclave.targetId, `solo_${conclave.targetId}`],
  });

  return {
    conclave,
    tally,
    quorumSize: s.quorumSize,
    votes: publicVotes,
    myVote,
    isShadow,
    viewers,
    analysis,
    dna: formatDecisionDNA(analysis),
  };
}

async function summarizeConclave(
  conclave: Conclave,
  quorumSize: number,
): Promise<ConclaveSummary> {
  const votes = await getVotes(conclave.id);
  const tally = tallyVotes(votes);
  return {
    id: conclave.id,
    postId: conclave.conclavePostId,
    targetKind: conclave.targetKind,
    authorName: conclave.authorName,
    contentSnippet: conclave.contentSnippet,
    total: tally.total,
    quorumSize,
    closesAt: conclave.closesAt,
  };
}

/** Assembles the subreddit-wide Living Rulebook dashboard snapshot. */
export async function buildRulebookData(
  subredditName: string,
): Promise<RulebookData> {
  const s = await loadSettings();
  const now = Date.now();

  const [total, weekCount, ids, shadowMods, sem] = await Promise.all([
    precedentCount(),
    precedentCountSince(now - 7 * DAY_MS),
    recentPrecedentIds(RULEBOOK_LOAD),
    listShadowMods(),
    getSemanticConfig(),
  ]);

  const precedents = await getPrecedentsByIds(ids);
  const counts = outcomeCounts(precedents);
  const sparkline = decisionsByDay(precedents, SPARK_DAYS, now);

  const openIds = await listOpenConclaves(Number.MAX_SAFE_INTEGER);
  const openConclaves: ConclaveSummary[] = [];
  for (const id of openIds.slice(0, 25)) {
    const c = await getConclave(id);
    if (c && !c.closed) {
      openConclaves.push(await summarizeConclave(c, s.quorumSize));
    }
  }
  openConclaves.sort((a, b) => a.closesAt - b.closesAt);

  return {
    subredditName,
    precedentCount: total,
    weekCount,
    outcomeCounts: counts,
    sparkline,
    recent: precedents.slice(0, 8),
    openConclaves,
    shadowMods,
    semanticEnabled: sem.enabled,
    probes: SEED_DEMO_PROBES,
  };
}
