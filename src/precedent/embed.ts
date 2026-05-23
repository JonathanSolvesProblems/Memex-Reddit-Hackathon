const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "to", "of",
  "in", "on", "at", "by", "for", "with", "about", "as", "from", "this",
  "that", "these", "those", "i", "you", "he", "she", "we", "they", "it",
  "my", "your", "his", "her", "our", "their", "its", "me", "us", "them",
  "him", "so", "if", "than", "then", "what", "which", "who", "how", "why",
  "when", "where", "not", "no", "yes", "can", "will", "would", "could",
  "should", "may", "might", "just", "also", "very", "more", "most", "some",
  "any", "all", "one", "two", "out", "up", "down", "off",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    // Keep letters/numbers from any language (not just a-z) so the precedent
    // engine works on non-English subreddits too.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith("ing")) return token.slice(0, -3);
  if (token.endsWith("ed")) return token.slice(0, -2);
  if (token.endsWith("ly")) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function trigrams(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 2; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return grams;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const ngramsA = trigrams(a.join(" "));
  const ngramsB = trigrams(b.join(" "));
  return jaccard(setA, setB) * 0.4 + jaccard(ngramsA, ngramsB) * 0.6;
}

export function fingerprint(tokens: string[]): string {
  const sorted = [...new Set(tokens)].sort();
  let hash = 5381;
  for (const t of sorted) {
    for (let i = 0; i < t.length; i++) {
      hash = ((hash * 33) ^ t.charCodeAt(i)) >>> 0;
    }
  }
  return hash.toString(36);
}
