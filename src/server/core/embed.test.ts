import { describe, expect, it } from "vitest";
import {
  buildPostSnippet,
  externalDomain,
  fingerprint,
  jaccard,
  tokenize,
  tokenSimilarity,
  trigrams,
} from "./embed";

describe("tokenize", () => {
  it("lowercases, drops stopwords, and stems tokens longer than 4 chars", () => {
    const tokens = tokenize("The CATS are running quickly to the Stores");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("are");
    expect(tokens).toContain("runn"); // "running" -> drop "ing"
    expect(tokens).toContain("quick"); // "quickly" -> drop "ly"
    expect(tokens).toContain("store"); // "stores" -> drop "s"
    expect(tokens).toContain("cats"); // <=4 chars: left as-is by design
  });

  it("normalizes urls to a marker and keeps unicode letters", () => {
    expect(tokenize("see https://spam.example.com/x now")).toContain("url");
    expect(tokenize("niño corre rápido")).toContain("niño");
  });

  it("returns nothing for empty/stopword-only input", () => {
    expect(tokenize("the a an of to")).toEqual([]);
  });
});

describe("externalDomain", () => {
  it("extracts the bare host and strips www", () => {
    expect(externalDomain("https://www.Beacons.ai/promo")).toBe("beacons.ai");
  });
  it("ignores reddit-internal links and bad input", () => {
    expect(externalDomain("https://www.reddit.com/r/x")).toBe("");
    expect(externalDomain("https://redd.it/abc")).toBe("");
    expect(externalDomain("not a url")).toBe("");
    expect(externalDomain(undefined)).toBe("");
  });
});

describe("buildPostSnippet", () => {
  it("folds in external domains from url and body so repeat spam matches", () => {
    const snippet = buildPostSnippet({
      title: "Check this out",
      body: "great deal at https://shoppy.example/x",
      url: "https://promo.example/landing",
    });
    expect(snippet).toContain("Check this out");
    expect(snippet).toContain("promo.example");
    expect(snippet).toContain("shoppy.example");
  });

  it("returns just the text when there are no external links", () => {
    expect(buildPostSnippet({ title: "Hi", body: "there" })).toBe("Hi\nthere");
  });
});

describe("jaccard + trigrams", () => {
  it("is 1 for identical sets and 0 for disjoint", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
  it("produces overlapping trigrams for similar strings", () => {
    const a = trigrams("discount code");
    const b = trigrams("discount codes");
    expect(jaccard(a, b)).toBeGreaterThan(0.5);
  });
});

describe("tokenSimilarity", () => {
  it("scores paraphrases of the same idea above unrelated text", () => {
    const affiliateA = tokenize("use my discount code for the store affiliate link");
    const affiliateB = tokenize("discount promo code store affiliate referral link");
    const unrelated = tokenize("what time does the verification process open");
    expect(tokenSimilarity(affiliateA, affiliateB)).toBeGreaterThan(
      tokenSimilarity(affiliateA, unrelated),
    );
  });
  it("returns 0 when either side is empty", () => {
    expect(tokenSimilarity([], ["a"])).toBe(0);
  });
});

describe("fingerprint", () => {
  it("is order-independent and stable", () => {
    expect(fingerprint(["b", "a", "a"])).toBe(fingerprint(["a", "b"]));
  });
  it("differs for different token sets", () => {
    expect(fingerprint(["a", "b"])).not.toBe(fingerprint(["a", "c"]));
  });
});
