import type { RedisClient, TriggerContext } from "@devvit/public-api";
import type {
  DecisionAnalysis,
  Precedent,
  PrecedentMatch,
  VoteChoice,
} from "../types.js";
import { VOTE_CHOICES } from "../types.js";
import {
  getPrecedent,
  getPrecedentTokens,
  recentPrecedentIds,
  savePrecedent,
} from "../redis.js";
import { fingerprint, tokenize, tokenSimilarity } from "./embed.js";

export async function recordDecision(
  redis: RedisClient,
  precedent: Omit<Precedent, "fingerprint">,
): Promise<Precedent> {
  const tokens = tokenize(precedent.contentSnippet);
  const fp = fingerprint(tokens);
  const enriched: Precedent = { ...precedent, fingerprint: fp };
  await savePrecedent(redis, enriched, tokens);
  return enriched;
}

export interface RetrieveOptions {
  limit: number;
  minSimilarity: number;
  topK?: number;
  excludeTargetIds?: string[];
}

async function scoreAll(
  context: Pick<TriggerContext, "redis">,
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<PrecedentMatch[]> {
  const { redis } = context;
  const queryTokens = tokenize(contentSnippet);
  if (queryTokens.length === 0) return [];

  const ids = await recentPrecedentIds(redis, options.limit);
  const excludeSet = new Set(options.excludeTargetIds ?? []);
  const matches: PrecedentMatch[] = [];

  for (const id of ids) {
    if (excludeSet.has(id)) continue;
    const tokens = await getPrecedentTokens(redis, id);
    if (tokens.length === 0) continue;
    const sim = tokenSimilarity(queryTokens, tokens) * 100;
    if (sim < options.minSimilarity) continue;
    const precedent = await getPrecedent(redis, id);
    if (!precedent) continue;
    matches.push({ precedent, similarity: sim });
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

export async function findPrecedents(
  context: Pick<TriggerContext, "redis">,
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<PrecedentMatch[]> {
  const all = await scoreAll(context, contentSnippet, options);
  return all.slice(0, options.topK ?? 3);
}

/**
 * The headline feature: not just "similar items" but the team's *decision
 * pattern* on that kind of content — how consistently they ruled, and which
 * way. This is the institutional-memory signal no other mod tool surfaces.
 */
export async function analyzeDecision(
  context: Pick<TriggerContext, "redis">,
  contentSnippet: string,
  options: RetrieveOptions,
): Promise<DecisionAnalysis> {
  const all = await scoreAll(context, contentSnippet, options);
  const counts: Record<VoteChoice, number> = {
    remove: 0,
    keep: 0,
    warn: 0,
    escalate: 0,
  };
  for (const m of all) counts[m.precedent.action] += 1;

  let dominant: VoteChoice | undefined;
  let max = 0;
  for (const c of VOTE_CHOICES) {
    if (counts[c] > max) {
      max = counts[c];
      dominant = c;
    }
  }

  const consideredCount = all.length;
  const consistencyPct =
    consideredCount > 0 && dominant
      ? Math.round((counts[dominant] / consideredCount) * 100)
      : 0;

  return {
    matches: all.slice(0, options.topK ?? 3),
    consideredCount,
    counts,
    dominant,
    consistencyPct,
  };
}

/** Plain-text "Decision DNA" card for the menu modal (form description). */
export function formatDecisionDNA(analysis: DecisionAnalysis): string {
  if (analysis.consideredCount === 0) {
    return "No similar past decisions found.\n\nYour team hasn't ruled on content like this before — this would set the precedent.";
  }
  const lines: string[] = [];
  const noun = analysis.consideredCount === 1 ? "decision" : "decisions";
  lines.push(
    `Your team has made ${analysis.consideredCount} similar ${noun}.`,
  );
  if (analysis.dominant) {
    lines.push(
      `Dominant outcome: ${analysis.dominant.toUpperCase()} — ${analysis.consistencyPct}% consistent.`,
    );
    if (analysis.consistencyPct < 60) {
      lines.push(
        "⚠ Low consistency — your team has handled this kind of content different ways. Worth a Conclave.",
      );
    }
  }
  lines.push("");
  lines.push("Breakdown:");
  for (const c of VOTE_CHOICES) {
    if (analysis.counts[c] > 0) {
      lines.push(`  • ${c}: ${analysis.counts[c]}`);
    }
  }
  lines.push("");
  lines.push("Closest matches:");
  analysis.matches.forEach((m, i) => {
    const reason = m.precedent.reason ? `  [${m.precedent.reason}]` : "";
    lines.push(
      `  ${i + 1}. ${m.precedent.action.toUpperCase()} (${m.similarity.toFixed(0)}%) — ${truncate(m.precedent.contentSnippet, 60)}${reason}`,
    );
  });
  return lines.join("\n");
}

export function summarizeMatches(matches: PrecedentMatch[]): string {
  if (matches.length === 0) return "_No similar past decisions found._";
  return matches
    .map((m, i) => {
      const date = new Date(m.precedent.decidedAt).toISOString().slice(0, 10);
      const reason = m.precedent.reason ? ` — _${m.precedent.reason}_` : "";
      return (
        `${i + 1}. **${m.precedent.action.toUpperCase()}** by u/${m.precedent.modName}` +
        ` on ${date} (${m.similarity.toFixed(0)}% similar)${reason}\n` +
        `   ↳ [view](${m.precedent.permalink})`
      );
    })
    .join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
