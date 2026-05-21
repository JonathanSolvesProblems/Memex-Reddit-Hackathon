import { describe, expect, it } from "vitest";
import { tokenize, tokenSimilarity, fingerprint } from "../precedent/embed.js";
import { tallyVotes } from "../redis.js";
import { evaluateAutoRoute } from "../conclave/router.js";
import type { Vote } from "../types.js";
import type { QuorumSettings } from "../settings.js";

const baseSettings: QuorumSettings = {
  quorumSize: 3,
  voteWindowHours: 24,
  autoRouteEnabled: true,
  autoRouteMinReports: 2,
  autoRouteMaxAccountAgeDays: 30,
  autoRouteKeywords: [],
  calibrationWindowDays: 21,
  precedentLimit: 500,
  precedentMinSimilarity: 25,
  banRequiresHumanClick: true,
};

function vote(choice: Vote["choice"], shadow = false): Vote {
  return {
    conclaveId: "c1",
    modName: `m_${Math.random()}`,
    choice,
    reason: "",
    shadow,
    castAt: Date.now(),
  };
}

describe("tokenize", () => {
  it("strips stopwords and short tokens", () => {
    const tokens = tokenize("This is a test of the spam removal system");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("is");
    expect(tokens).toContain("test");
    expect(tokens).toContain("spam");
  });

  it("replaces URLs with a marker", () => {
    const tokens = tokenize("check this https://evil.example.com/scam now");
    expect(tokens).toContain("url");
  });
});

describe("tokenSimilarity", () => {
  it("scores near-identical text high", () => {
    const a = tokenize("buy cheap followers click this link now");
    const b = tokenize("buy cheap followers click the link right now");
    expect(tokenSimilarity(a, b)).toBeGreaterThan(0.4);
  });

  it("scores unrelated text low", () => {
    const a = tokenize("what is the best recipe for sourdough bread");
    const b = tokenize("political debate about tax policy reform");
    expect(tokenSimilarity(a, b)).toBeLessThan(0.15);
  });

  it("returns 0 for empty input", () => {
    expect(tokenSimilarity([], tokenize("anything"))).toBe(0);
  });
});

describe("fingerprint", () => {
  it("is stable regardless of token order", () => {
    const a = fingerprint(["spam", "link", "scam"]);
    const b = fingerprint(["scam", "spam", "link"]);
    expect(a).toBe(b);
  });
});

describe("tallyVotes", () => {
  it("ignores shadow votes in the count", () => {
    const tally = tallyVotes([
      vote("remove"),
      vote("remove"),
      vote("keep", true),
    ]);
    expect(tally.total).toBe(2);
    expect(tally.remove).toBe(2);
    expect(tally.winner).toBe("remove");
  });

  it("returns no winner on a tie", () => {
    const tally = tallyVotes([vote("remove"), vote("keep")]);
    expect(tally.winner).toBeUndefined();
  });

  it("picks the plurality winner", () => {
    const tally = tallyVotes([
      vote("remove"),
      vote("remove"),
      vote("warn"),
    ]);
    expect(tally.winner).toBe("remove");
  });
});

describe("evaluateAutoRoute", () => {
  it("does not route when disabled", () => {
    const d = evaluateAutoRoute(
      { contentText: "x", authorName: "u", reportCount: 5 },
      { ...baseSettings, autoRouteEnabled: false },
    );
    expect(d.route).toBe(false);
  });

  it("requires the minimum report count", () => {
    const d = evaluateAutoRoute(
      { contentText: "x", authorName: "u", reportCount: 1 },
      baseSettings,
    );
    expect(d.route).toBe(false);
  });

  it("skips authors older than the age threshold", () => {
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const d = evaluateAutoRoute(
      {
        contentText: "x",
        authorName: "u",
        reportCount: 3,
        authorCreatedAt: old,
      },
      baseSettings,
    );
    expect(d.route).toBe(false);
  });

  it("routes a young, reported account", () => {
    const young = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const d = evaluateAutoRoute(
      {
        contentText: "x",
        authorName: "u",
        reportCount: 3,
        authorCreatedAt: young,
      },
      baseSettings,
    );
    expect(d.route).toBe(true);
  });

  it("requires a keyword match when keywords are configured", () => {
    const settings = {
      ...baseSettings,
      autoRouteKeywords: ["onlyfans", "crypto"],
    };
    const noMatch = evaluateAutoRoute(
      { contentText: "a normal post", authorName: "u", reportCount: 3 },
      settings,
    );
    expect(noMatch.route).toBe(false);

    const match = evaluateAutoRoute(
      { contentText: "join my crypto group", authorName: "u", reportCount: 3 },
      settings,
    );
    expect(match.route).toBe(true);
  });
});
