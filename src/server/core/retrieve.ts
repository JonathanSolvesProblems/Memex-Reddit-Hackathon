import { redis } from "@devvit/web/server";
import type {
  DecisionAnalysis,
  Precedent,
  PrecedentMatch,
  VoteChoice,
} from "../../shared/types";
import { VOTE_CHOICES } from "../../shared/types";
import { K, recentPrecedentIds, savePrecedent } from "./redis";
import { fingerprint, tokenize, tokenSimilarity } from "./embed";

export async function recordDecision(
  precedent: Omit<Precedent, "fingerprint">,
): Promise<Precedent> {
  const tokens = tokenize(precedent.contentSnippet);
  const fp = fingerprint(tokens);
  const enriched: Precedent = { ...precedent, fingerprint: fp };
  await savePrecedent(enriched, tokens);
  return enriched;
}

export type RetrieveOptions = {
  limit: number;
  minSimilarity: number;
  topK?: number;
  excludeTargetIds?: string[];
};

async function scoreAll(
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<PrecedentMatch[]> {
  const queryTokens = tokenize(contentSnippet);
  if (queryTokens.length === 0) return [];

  const ids = await recentPrecedentIds(options.limit);
  const excludeSet = new Set(options.excludeTargetIds ?? []);
  const candidates = ids.filter((id) => !excludeSet.has(id));
  if (candidates.length === 0) return [];

  // One batched read for all candidate token strings, then score in memory.
  const tokenStrings = await redis.mGet(candidates.map(K.precedentTokens));
  const scored: { id: string; sim: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const raw = tokenStrings[i];
    if (!raw) continue;
    const tokens = raw.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    const sim = tokenSimilarity(queryTokens, tokens) * 100;
    if (sim < options.minSimilarity) continue;
    scored.push({ id: candidates[i], sim });
  }
  if (scored.length === 0) return [];

  // One batched read for the precedents that actually matched.
  const records = await redis.mGet(scored.map((s) => K.precedent(s.id)));
  const matches: PrecedentMatch[] = [];
  for (let i = 0; i < scored.length; i++) {
    const raw = records[i];
    if (!raw) continue;
    matches.push({
      precedent: JSON.parse(raw) as Precedent,
      similarity: scored[i].sim,
    });
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

export async function findPrecedents(
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<PrecedentMatch[]> {
  const all = await scoreAll(contentSnippet, options);
  return all.slice(0, options.topK ?? 3);
}

/**
 * The headline feature: not just "similar items" but the team's *decision
 * pattern* on that kind of content — how consistently they ruled, and which
 * way. This is the institutional-memory signal no other mod tool surfaces.
 */
export async function analyzeDecision(
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<DecisionAnalysis> {
  const all = await scoreAll(contentSnippet, options);
  const counts: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const m of all) counts[m.precedent.action] += 1;

  let max = 0;
  for (const c of VOTE_CHOICES) if (counts[c] > max) max = counts[c];
  const leaders = VOTE_CHOICES.filter((c) => counts[c] === max && max > 0);
  const dominant = leaders.length === 1 ? leaders[0] : undefined;

  const consideredCount = all.length;
  const consistencyPct =
    consideredCount > 0 ? Math.round((max / consideredCount) * 100) : 0;

  return {
    matches: all.slice(0, options.topK ?? 3),
    consideredCount,
    counts,
    dominant,
    consistencyPct,
  };
}

/**
 * "Decision DNA" summary string. Reads as clean flowing prose with sentence
 * breaks (no em-dashes).
 */
export function formatDecisionDNA(analysis: DecisionAnalysis): string {
  if (analysis.consideredCount === 0) {
    return "No similar past decisions found. Your team hasn't ruled on content like this before, so this would set the precedent.";
  }
  const noun = analysis.consideredCount === 1 ? "decision" : "decisions";
  const parts: string[] = [];

  parts.push(`Your team has made ${analysis.consideredCount} similar ${noun}.`);

  if (analysis.dominant) {
    parts.push(
      `Dominant outcome: ${analysis.dominant.toUpperCase()} (${analysis.consistencyPct}% consistent).`,
    );
    if (analysis.consistencyPct < 60) {
      parts.push(
        "Low consistency: the team has handled this kind of content different ways. Worth a Conclave.",
      );
    }
  } else {
    parts.push(
      "Split decision: no dominant outcome, the team is divided. Worth a Conclave.",
    );
  }

  const breakdown = VOTE_CHOICES.filter((c) => analysis.counts[c] > 0)
    .map((c) => `${analysis.counts[c]} ${c}`)
    .join(", ");
  parts.push(`Breakdown: ${breakdown}.`);

  const matches = analysis.matches
    .map((m) => {
      const reason = m.precedent.reason ? ` [${m.precedent.reason}]` : "";
      return `${m.precedent.action.toUpperCase()} ${m.similarity.toFixed(0)}% "${truncate(m.precedent.contentSnippet, 50)}"${reason}`;
    })
    .join("; ");
  parts.push(`Closest matches: ${matches}.`);

  return parts.join("\n\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
