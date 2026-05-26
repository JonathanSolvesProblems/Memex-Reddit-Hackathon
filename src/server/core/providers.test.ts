import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DOMAINS,
  EMBEDDING_PROVIDERS,
  detectProvider,
} from "./providers";

describe("detectProvider", () => {
  it("detects OpenAI from sk- keys", () => {
    expect(detectProvider("sk-proj-abc123")?.id).toBe("openai");
    expect(detectProvider("sk-abc")?.id).toBe("openai");
  });

  it("detects Google Gemini from AIza keys", () => {
    expect(detectProvider("AIzaSyABC123")?.id).toBe("gemini");
  });

  it("returns undefined for Anthropic keys (no embeddings API)", () => {
    expect(detectProvider("sk-ant-api03-xyz")).toBeUndefined();
  });

  it("returns undefined for empty or unrecognized keys", () => {
    expect(detectProvider("")).toBeUndefined();
    expect(detectProvider("   ")).toBeUndefined();
    expect(detectProvider("random-token-1234")).toBeUndefined();
  });

  it("trims whitespace before matching", () => {
    expect(detectProvider("  sk-abc  ")?.id).toBe("openai");
  });
});

describe("provider registry", () => {
  it("exposes a hostname per provider for the http allowlist", () => {
    expect(EMBEDDING_DOMAINS).toContain("api.openai.com");
    expect(EMBEDDING_DOMAINS.length).toBe(EMBEDDING_PROVIDERS.length);
    for (const p of EMBEDDING_PROVIDERS) {
      expect(p.domain).toMatch(/^[a-z0-9.-]+$/); // bare hostname, no scheme/path
      expect(p.model.length).toBeGreaterThan(0);
    }
  });
});
