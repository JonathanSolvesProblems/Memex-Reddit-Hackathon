/**
 * Embedding-provider registry for the optional semantic layer.
 *
 * A moderator pastes an API key and Memex auto-detects the provider from the
 * key's shape (no provider dropdown to fiddle with), then routes embedding
 * requests to that provider's endpoint. New providers are added by appending one
 * entry here. This keeps the semantic engine vendor-agnostic and reusable.
 *
 * Devvit constraint: outbound hosts must be declared in
 * `devvit.json > permissions.http.domains`. `api.openai.com` is on Reddit's
 * global allowlist (works with no review); other hosts must be added there and
 * may require App Review before they function. Any blocked/failed request
 * degrades gracefully to the local lexical engine.
 */

const FETCH_TIMEOUT_MS = 8000;

export type EmbeddingProvider = {
  id: string;
  label: string;
  /** Hostname that must appear in devvit.json permissions.http.domains. */
  domain: string;
  /** Stable model id; part of the cache key so vendors/models never collide. */
  model: string;
  /** Whether a key of this shape belongs to this provider. */
  matches: (key: string) => boolean;
  /** Returns an embedding vector, or undefined on any failure. */
  embed: (text: string, key: string) => Promise<number[] | undefined>;
};

/** Runs `fn` with an abort-on-timeout signal; any throw resolves to undefined. */
async function withTimeout<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T | undefined>,
): Promise<T | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } catch (e) {
    console.error(
      `[Memex semantic] ${label} request failed:`,
      e instanceof Error ? e.message : String(e),
    );
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const openai: EmbeddingProvider = {
  id: "openai",
  label: "OpenAI",
  domain: "api.openai.com",
  model: "text-embedding-3-small",
  matches: (k) => k.startsWith("sk-") && !k.startsWith("sk-ant-"),
  embed: (text, key) =>
    withTimeout("OpenAI", async (signal) => {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
        signal,
      });
      if (!res.ok) {
        console.error(`[Memex semantic] OpenAI returned ${res.status}`);
        return undefined;
      }
      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vec = json.data?.[0]?.embedding;
      return Array.isArray(vec) && vec.length > 0 ? vec : undefined;
    }),
};

const gemini: EmbeddingProvider = {
  id: "gemini",
  label: "Google Gemini",
  domain: "generativelanguage.googleapis.com",
  model: "text-embedding-004",
  matches: (k) => k.startsWith("AIza"),
  embed: (text, key) =>
    withTimeout("Gemini", async (signal) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] } }),
          signal,
        },
      );
      if (!res.ok) {
        console.error(`[Memex semantic] Gemini returned ${res.status}`);
        return undefined;
      }
      const json = (await res.json()) as { embedding?: { values?: number[] } };
      const vec = json.embedding?.values;
      return Array.isArray(vec) && vec.length > 0 ? vec : undefined;
    }),
};

export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = [openai, gemini];

/** All provider hostnames; mirror these into devvit.json http.domains to enable. */
export const EMBEDDING_DOMAINS: string[] = EMBEDDING_PROVIDERS.map(
  (p) => p.domain,
);

/**
 * Detects the embedding provider from an API key's shape. Returns undefined for
 * empty keys, Anthropic keys (which have no embeddings API), or unrecognized
 * shapes, so the caller cleanly falls back to the local engine.
 */
export function detectProvider(key: string): EmbeddingProvider | undefined {
  const k = key.trim();
  if (!k || k.startsWith("sk-ant-")) return undefined;
  return EMBEDDING_PROVIDERS.find((p) => p.matches(k));
}
