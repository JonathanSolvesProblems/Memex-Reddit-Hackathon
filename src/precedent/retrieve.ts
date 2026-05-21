import type { RedisClient, TriggerContext } from "@devvit/public-api";
import type { Precedent, PrecedentMatch } from "../types.js";
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

export async function findPrecedents(
  context: Pick<TriggerContext, "redis">,
  contentSnippet: string,
  options: {
    limit: number;
    minSimilarity: number;
    topK?: number;
    excludeTargetIds?: string[];
  },
): Promise<PrecedentMatch[]> {
  const { redis } = context;
  const topK = options.topK ?? 3;
  const queryTokens = tokenize(contentSnippet);
  if (queryTokens.length === 0) return [];

  const ids = await recentPrecedentIds(redis, options.limit);
  const excludeSet = new Set(options.excludeTargetIds ?? []);
  const matches: PrecedentMatch[] = [];

  for (const id of ids) {
    if (excludeSet.has(id)) continue;
    const tokens = await getPrecedentTokens(redis, id);
    if (tokens.length === 0) continue;
    const sim = tokenSimilarity(queryTokens, tokens);
    const pctSim = sim * 100;
    if (pctSim < options.minSimilarity) continue;
    const precedent = await getPrecedent(redis, id);
    if (!precedent) continue;
    matches.push({ precedent, similarity: pctSim });
  }

  return matches
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
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
