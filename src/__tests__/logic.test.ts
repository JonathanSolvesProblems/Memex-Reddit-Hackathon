import { describe, expect, it } from "vitest";
import {
  tokenize,
  tokenSimilarity,
  fingerprint,
  externalDomain,
} from "../precedent/embed.js";
import { tallyVotes } from "../redis.js";
import { evaluateAutoRoute } from "../conclave/router.js";
import { decisionsByDay, outcomeCounts } from "../stats.js";
import { shouldFlag } from "../audit.js";
import type { DecisionAnalysis, Precedent, Vote } from "../types.js";
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
  autoSweepEnabled: false,
  sweepScanLimit: 100,
  sweepMinConsistency: 70,
  sweepIncludeWarn: false,
  sweepReportToQueue: true,
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

function prec(decidedAt: number, action: Precedent["action"] = "remove"): Precedent {
  return {
    id: `p_${Math.random()}`,
    subredditName: "s",
    targetKind: "post",
    contentSnippet: "x",
    action,
    modName: "m",
    reason: "",
    permalink: "",
    decidedAt,
    fingerprint: "f",
  };
}

describe("decisionsByDay", () => {
  const now = 1_000_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("buckets into N day-windows, newest on the right", () => {
    const bins = decisionsByDay(
      [prec(now), prec(now - 10), prec(now - day), prec(now - 6 * day)],
      7,
      now,
    );
    expect(bins).toHaveLength(7);
    expect(bins[6]).toBe(2); // today (now and now-10ms)
    expect(bins[5]).toBe(1); // yesterday
    expect(bins[0]).toBe(1); // 6 days ago
  });

  it("ignores decisions outside the window and handles days<=0", () => {
    expect(decisionsByDay([prec(now - 30 * day)], 7, now).reduce((a, b) => a + b, 0)).toBe(0);
    expect(decisionsByDay([prec(now)], 0, now)).toEqual([]);
  });
});

describe("outcomeCounts", () => {
  it("tallies each outcome", () => {
    const c = outcomeCounts([
      prec(1, "remove"),
      prec(2, "remove"),
      prec(3, "keep"),
      prec(4, "warn"),
    ]);
    expect(c).toEqual({ remove: 2, keep: 1, warn: 1, escalate: 0 });
  });
});

function analysis(over: Partial<DecisionAnalysis>): DecisionAnalysis {
  return {
    matches: [],
    consideredCount: 5,
    counts: { remove: 0, keep: 0, warn: 0, escalate: 0 },
    dominant: undefined,
    consistencyPct: 0,
    ...over,
  };
}

describe("shouldFlag (consistency sweep)", () => {
  it("flags content matching a consistent past REMOVE", () => {
    const a = analysis({ dominant: "remove", consistencyPct: 80, counts: { remove: 4, keep: 1, warn: 0, escalate: 0 } });
    expect(shouldFlag(a, 70, false)).toBe(true);
  });
  it("does not flag below the consistency threshold", () => {
    const a = analysis({ dominant: "remove", consistencyPct: 60 });
    expect(shouldFlag(a, 70, false)).toBe(false);
  });
  it("does not flag KEEP-dominant content", () => {
    const a = analysis({ dominant: "keep", consistencyPct: 95 });
    expect(shouldFlag(a, 70, false)).toBe(false);
  });
  it("flags WARN only when includeWarn is on", () => {
    const a = analysis({ dominant: "warn", consistencyPct: 90 });
    expect(shouldFlag(a, 70, false)).toBe(false);
    expect(shouldFlag(a, 70, true)).toBe(true);
  });
  it("never flags split or no-history content", () => {
    expect(shouldFlag(analysis({ dominant: undefined, consistencyPct: 90 }), 70, true)).toBe(false);
    expect(shouldFlag(analysis({ consideredCount: 0 }), 0, true)).toBe(false);
  });
});

describe("externalDomain", () => {
  it("extracts external domains and strips www", () => {
    expect(externalDomain("https://www.beacons.ai/foo")).toBe("beacons.ai");
    expect(externalDomain("https://youtube.com/watch?v=x")).toBe("youtube.com");
  });
  it("ignores reddit self-post urls and bad input", () => {
    expect(externalDomain("https://www.reddit.com/r/x/comments/1/abc")).toBe("");
    expect(externalDomain("https://redd.it/abc")).toBe("");
    expect(externalDomain(undefined)).toBe("");
    expect(externalDomain("not a url")).toBe("");
  });
  it("makes two posts linking the same domain matchable", () => {
    const a = tokenize(`buy followers ${externalDomain("https://beacons.ai/x")}`);
    const b = tokenize(`cheap likes ${externalDomain("https://www.beacons.ai/y")}`);
    // "beacons" stems to "beacon"; the shared domain token makes them match.
    expect(a).toContain("beacon");
    expect(b).toContain("beacon");
  });
});

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

  it("returns no winner on a 3-way tie regardless of order", () => {
    expect(tallyVotes([vote("warn"), vote("keep"), vote("remove")]).winner).toBeUndefined();
    expect(tallyVotes([vote("remove"), vote("keep"), vote("warn")]).winner).toBeUndefined();
  });

  it("returns no winner when two choices tie for the lead", () => {
    const tally = tallyVotes([
      vote("remove"),
      vote("remove"),
      vote("keep"),
      vote("keep"),
      vote("warn"),
    ]);
    expect(tally.winner).toBeUndefined();
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

  it("at submit time (ignoreReports) routes on keyword match with zero reports", () => {
    const settings = { ...baseSettings, autoRouteKeywords: ["crypto"] };
    const d = evaluateAutoRoute(
      { contentText: "buy my crypto", authorName: "u", reportCount: 0 },
      settings,
      { ignoreReports: true },
    );
    expect(d.route).toBe(true);
  });

  it("at submit time does not route when no keyword filter is set", () => {
    const d = evaluateAutoRoute(
      { contentText: "anything", authorName: "u", reportCount: 0 },
      { ...baseSettings, autoRouteKeywords: [] },
      { ignoreReports: true },
    );
    expect(d.route).toBe(false);
  });
});
