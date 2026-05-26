import { describe, expect, it } from "vitest";
import type { DecisionAnalysis, Precedent, Vote } from "../../shared/types";
import { decisionsByDay, outcomeCounts } from "./stats";
import { pluralityWinner, tallyVotes } from "./redis";
import { evaluateAutoRoute } from "./router";
import { shouldFlag } from "./audit";
import { cosine, rescaleSemantic } from "./semantic";
import { DEFAULT_SETTINGS } from "./settings";

const DAY = 24 * 60 * 60 * 1000;

function precedent(p: Partial<Precedent>): Precedent {
  return {
    id: "x",
    subredditName: "demo",
    targetKind: "post",
    contentSnippet: "",
    action: "remove",
    modName: "m",
    reason: "",
    permalink: "",
    decidedAt: Date.now(),
    fingerprint: "",
    ...p,
  };
}

function vote(choice: Vote["choice"], shadow = false): Vote {
  return { conclaveId: "c", modName: "m" + Math.random(), choice, reason: "", shadow, castAt: Date.now() };
}

describe("stats.decisionsByDay", () => {
  it("buckets decisions into day windows, newest on the right", () => {
    const now = Date.now();
    const bins = decisionsByDay(
      [
        precedent({ decidedAt: now }),
        precedent({ decidedAt: now - 1 * DAY }),
        precedent({ decidedAt: now - 1 * DAY }),
      ],
      3,
      now,
    );
    expect(bins).toEqual([0, 2, 1]);
  });
  it("returns an all-zero array of the right length for no data", () => {
    expect(decisionsByDay([], 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("stats.outcomeCounts", () => {
  it("counts each outcome", () => {
    const counts = outcomeCounts([
      precedent({ action: "remove" }),
      precedent({ action: "remove" }),
      precedent({ action: "keep" }),
    ]);
    expect(counts).toEqual({ remove: 2, keep: 1, warn: 0, escalate: 0 });
  });
});

describe("redis.tallyVotes / pluralityWinner", () => {
  it("ignores shadow votes and picks the plurality winner", () => {
    const t = tallyVotes([vote("remove"), vote("remove"), vote("keep"), vote("keep", true)]);
    expect(t.total).toBe(3); // shadow excluded
    expect(t.remove).toBe(2);
    expect(t.winner).toBe("remove");
  });
  it("returns no winner on a tie", () => {
    expect(pluralityWinner({ remove: 1, keep: 1, warn: 0, escalate: 0 })).toBeUndefined();
  });
  it("returns no winner with zero votes", () => {
    expect(pluralityWinner({ remove: 0, keep: 0, warn: 0, escalate: 0 })).toBeUndefined();
  });
});

describe("router.evaluateAutoRoute", () => {
  it("does not route when disabled", () => {
    const s = { ...DEFAULT_SETTINGS, autoRouteEnabled: false };
    expect(evaluateAutoRoute({ contentText: "x", authorName: "a", reportCount: 9 }, s).route).toBe(false);
  });
  it("routes on a keyword match at submit time (reports ignored)", () => {
    const s = { ...DEFAULT_SETTINGS, autoRouteEnabled: true, autoRouteKeywords: ["affiliate"] };
    const r = evaluateAutoRoute(
      { contentText: "buy my affiliate link", authorName: "a", reportCount: 0 },
      s,
      { ignoreReports: true },
    );
    expect(r.route).toBe(true);
    expect(r.reason).toContain("affiliate");
  });
  it("does not route at submit time without keywords configured", () => {
    const s = { ...DEFAULT_SETTINGS, autoRouteEnabled: true, autoRouteKeywords: [] };
    expect(
      evaluateAutoRoute({ contentText: "anything", authorName: "a", reportCount: 0 }, s, {
        ignoreReports: true,
      }).route,
    ).toBe(false);
  });
});

describe("audit.shouldFlag", () => {
  const base: DecisionAnalysis = {
    matches: [],
    consideredCount: 5,
    counts: { remove: 5, keep: 0, warn: 0, escalate: 0 },
    dominant: "remove",
    consistencyPct: 100,
  };
  it("flags a consistent REMOVE pattern", () => {
    expect(shouldFlag(base, 70, false)).toBe(true);
  });
  it("does not flag below the consistency threshold", () => {
    expect(shouldFlag({ ...base, consistencyPct: 50 }, 70, false)).toBe(false);
  });
  it("never flags split/no-dominant content", () => {
    expect(shouldFlag({ ...base, dominant: undefined }, 0, false)).toBe(false);
  });
  it("only flags WARN when includeWarn is set", () => {
    const warnDom = { ...base, dominant: "warn" as const, counts: { remove: 0, keep: 0, warn: 5, escalate: 0 } };
    expect(shouldFlag(warnDom, 70, false)).toBe(false);
    expect(shouldFlag(warnDom, 70, true)).toBe(true);
  });
});

describe("semantic.cosine / rescaleSemantic", () => {
  it("cosine is 1 for parallel and 0 for orthogonal vectors", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it("rescales the useful [0.7,1] cosine band onto [0,1]", () => {
    expect(rescaleSemantic(0.7)).toBeCloseTo(0, 5);
    expect(rescaleSemantic(1.0)).toBeCloseTo(1, 5);
    expect(rescaleSemantic(0.85)).toBeCloseTo(0.5, 5);
    expect(rescaleSemantic(0.5)).toBe(0); // clamped
  });
});
