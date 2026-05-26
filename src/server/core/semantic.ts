import { redis, settings } from "@devvit/web/server";
import {
  detectProvider,
  type EmbeddingProvider,
} from "./providers";

/**
 * Optional semantic-matching layer.
 *
 * Memex's Decision DNA runs on a fully local lexical engine (token + trigram
 * Jaccard) that needs zero configuration, never leaves Reddit, and is the
 * always-on default. This module is a *pluggable enhancement*: when a moderator
 * supplies an embedding API key, we auto-detect the provider (see providers.ts),
 * embed content, and blend cosine similarity into the score, so paraphrases the
 * lexical engine misses ("promo code for my shop" vs "discount link to my
 * store") still match.
 *
 * Everything here degrades gracefully: no key, a disabled toggle, an
 * unrecognized key, or any network error falls straight back to the local
 * engine. The app is fully functional and demo-ready with this turned off.
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SemanticConfig = {
  /** True only when the toggle is on AND a recognized key is present. */
  enabled: boolean;
  /** Raw value of the toggle, regardless of whether a key is set. */
  toggleOn: boolean;
  apiKey?: string;
  /** Auto-detected from the key shape; undefined when unrecognized/disabled. */
  provider?: EmbeddingProvider;
  /** Blend weight for the semantic score in [0,1]; lexical gets (1 - weight). */
  weight: number;
};

/**
 * Reads the semantic settings once and auto-detects the provider from the key.
 * `enabled` is true only when the toggle is on AND a recognized key is present,
 * so callers never have to special-case it.
 */
export async function getSemanticConfig(): Promise<SemanticConfig> {
  try {
    const [toggle, key, weight] = await Promise.all([
      settings.get<boolean>("semanticEnabled"),
      settings.get<string>("embeddingApiKey"),
      settings.get<number>("semanticWeight"),
    ]);
    const apiKey = typeof key === "string" ? key.trim() : "";
    const provider = apiKey ? detectProvider(apiKey) : undefined;
    const w = typeof weight === "number" ? weight : 50;
    const toggleOn = toggle === true;
    return {
      enabled: toggleOn && apiKey.length > 0 && provider !== undefined,
      toggleOn,
      apiKey: apiKey || undefined,
      provider,
      weight: Math.min(1, Math.max(0, w / 100)),
    };
  } catch {
    return { enabled: false, toggleOn: false, weight: 0.5 };
  }
}

/**
 * Embeds text via the configured provider, caching the vector in Redis keyed by
 * provider + model + a hash of the input so repeat lookups (and re-seeds) cost
 * nothing and different providers never collide. Returns undefined on any
 * failure so the caller falls back to the local engine.
 */
export async function embedText(
  text: string,
  config: SemanticConfig,
): Promise<number[] | undefined> {
  if (!config.enabled || !config.apiKey || !config.provider) return undefined;
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) return undefined;

  const { provider } = config;
  const cacheKey = `embed:cache:${provider.id}:${provider.model}:${hashString(trimmed)}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as number[];
  } catch {
    // cache miss / parse error -> recompute
  }

  const vec = await provider.embed(trimmed, config.apiKey);
  if (!vec) return undefined;

  try {
    await redis.set(cacheKey, JSON.stringify(vec), {
      expiration: new Date(Date.now() + CACHE_TTL_MS),
    });
  } catch {
    // best-effort cache write
  }
  return vec;
}

/** Standard cosine similarity in [-1, 1] for two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rescales raw embedding cosine onto a [0,1] band comparable to the lexical
 * Jaccard score. Modern embeddings rarely drop below ~0.7 even for unrelated
 * short text, so 0.7 -> 0 and 1.0 -> 1 spreads the useful range out and keeps
 * the blended score honest.
 */
export function rescaleSemantic(cos: number): number {
  const lo = 0.7;
  const hi = 1.0;
  return Math.min(1, Math.max(0, (cos - lo) / (hi - lo)));
}

function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
