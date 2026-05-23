import { describe, it, expect } from "vitest";
import { fakeContext } from "./fakes.js";
import {
  saveConclave,
  getConclave,
  getCalibrationFor,
  setShadowMod,
} from "../redis.js";
import { submitVote, closeExpired } from "../conclave/vote.js";
import {
  recordDecision,
  findPrecedents,
  analyzeDecision,
  formatDecisionDNA,
} from "../precedent/retrieve.js";
import type { VoteChoice } from "../types.js";
import type { Conclave } from "../types.js";
import type { QuorumSettings } from "../settings.js";

function settings(over?: Partial<QuorumSettings>): QuorumSettings {
  return {
    quorumSize: 1,
    voteWindowHours: 24,
    autoRouteEnabled: false,
    autoRouteMinReports: 2,
    autoRouteMaxAccountAgeDays: 30,
    autoRouteKeywords: [],
    calibrationWindowDays: 21,
    precedentLimit: 500,
    precedentMinSimilarity: 20,
    banRequiresHumanClick: true,
    ...over,
  };
}

function makeConclave(over?: Partial<Conclave>): Conclave {
  const now = Date.now();
  return {
    id: "c_test1",
    subredditName: "JonathanSolvesProblem",
    targetKind: "post",
    targetId: "t3_abc",
    authorName: "spammer",
    contentSnippet:
      "buy cheap followers click this link now to boost your account fast",
    permalink: "/r/x/comments/abc",
    openedAt: now,
    closesAt: now + 86_400_000,
    openedBy: "mod1",
    reason: "test",
    closed: false,
    conclavePostId: "t3_conclave",
    ...over,
  };
}

describe("vote → resolve → execute", () => {
  it("REMOVE at quorum removes the post and closes the room", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());

    const res = await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "remove", reason: "spam" },
      settings({ quorumSize: 1 }),
    );

    expect(res.ok).toBe(true);
    expect(res.resolved).toBe("remove");
    expect(h.reddit.actions.removed.map((r) => r.id)).toContain("t3_abc");
    const after = await getConclave(h.redis, "c_test1");
    expect(after?.closed).toBe(true);
    expect(after?.resolution).toBe("remove");
  });

  it("KEEP at quorum approves the post", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "keep", reason: "" },
      settings({ quorumSize: 1 }),
    );
    expect(h.reddit.actions.approved).toContain("t3_abc");
    expect(h.reddit.actions.removed).toHaveLength(0);
  });

  it("ESCALATE notifies modmail and performs no destructive action", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "escalate", reason: "" },
      settings({ quorumSize: 1 }),
    );
    expect(h.reddit.actions.removed).toHaveLength(0);
    expect(h.reddit.actions.approved).toHaveLength(0);
    expect(h.reddit.actions.modmails.length).toBeGreaterThan(0);
    expect(h.reddit.actions.modmails[0].bodyMarkdown).toContain("human click");
  });

  it("writes a native mod note on resolution", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "remove", reason: "spam" },
      settings({ quorumSize: 1 }),
    );
    expect(h.reddit.modNotes).toHaveLength(1);
    expect(h.reddit.modNotes[0].user).toBe("spammer");
    expect(h.reddit.modNotes[0].note).toContain("REMOVE");
  });

  it("does NOT resolve below quorum", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    const res = await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "remove", reason: "" },
      settings({ quorumSize: 3 }),
    );
    expect(res.resolved).toBeUndefined();
    expect(h.reddit.actions.removed).toHaveLength(0);
    const after = await getConclave(h.redis, "c_test1");
    expect(after?.closed).toBe(false);
  });

  it("resolves once the third vote lands", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    const s = settings({ quorumSize: 3 });
    await submitVote(h.context, { conclaveId: "c_test1", modName: "m1", choice: "remove", reason: "" }, s);
    await submitVote(h.context, { conclaveId: "c_test1", modName: "m2", choice: "remove", reason: "" }, s);
    const third = await submitVote(h.context, { conclaveId: "c_test1", modName: "m3", choice: "keep", reason: "" }, s);
    // 2 remove vs 1 keep -> remove wins
    expect(third.resolved).toBe("remove");
    expect(h.reddit.actions.removed.map((r) => r.id)).toContain("t3_abc");
  });
});

describe("precedent recording + surfacing", () => {
  it("a resolved decision becomes a retrievable precedent for similar content", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "remove", reason: "obvious spam" },
      settings({ quorumSize: 1 }),
    );

    const matches = await findPrecedents(
      h.context,
      "buy cheap followers click the link right now to boost the account",
      { limit: 500, minSimilarity: 20, topK: 3 },
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].precedent.action).toBe("remove");
    expect(matches[0].similarity).toBeGreaterThan(20);
  });

  it("reports a split decision (no dominant) when outcomes tie", async () => {
    const h = fakeContext();
    const content = "user posted an affiliate link with a discount promo code";
    await recordDecision(h.redis, {
      id: "tie1",
      subredditName: "s",
      targetKind: "post",
      contentSnippet: `${content} one`,
      action: "remove",
      modName: "a",
      reason: "",
      permalink: "/x",
      decidedAt: Date.now() - 1000,
    });
    await recordDecision(h.redis, {
      id: "tie2",
      subredditName: "s",
      targetKind: "post",
      contentSnippet: `${content} two`,
      action: "keep",
      modName: "b",
      reason: "",
      permalink: "/x",
      decidedAt: Date.now(),
    });
    const a = await analyzeDecision(
      h.context,
      "member shared an affiliate link with a promo discount code",
      { limit: 500, minSimilarity: 20, topK: 3 },
    );
    expect(a.consideredCount).toBe(2);
    expect(a.dominant).toBeUndefined();
    expect(a.consistencyPct).toBe(50);
    expect(formatDecisionDNA(a)).toContain("Split decision");
  });

  it("does not surface unrelated content", async () => {
    const h = fakeContext();
    await recordDecision(h.redis, {
      id: "p1",
      subredditName: "s",
      targetKind: "post",
      contentSnippet: "what is the best recipe for homemade sourdough bread",
      action: "keep",
      modName: "mod1",
      reason: "on topic",
      permalink: "/x",
      decidedAt: Date.now(),
    });
    const matches = await findPrecedents(
      h.context,
      "coordinated political brigade attacking our subreddit users",
      { limit: 500, minSimilarity: 25, topK: 3 },
    );
    expect(matches).toHaveLength(0);
  });
});

describe("Decision DNA (analyzeDecision)", () => {
  async function seed(h: ReturnType<typeof fakeContext>) {
    const base =
      "user posted an affiliate link to their own store promo discount code";
    const actions: VoteChoice[] = ["remove", "remove", "remove", "keep"];
    let i = 0;
    for (const action of actions) {
      await recordDecision(h.redis, {
        id: `seed_${i}`,
        subredditName: "s",
        targetKind: "post",
        contentSnippet: `${base} number ${i}`,
        action,
        modName: "mod1",
        reason: action === "keep" ? "regular contributor" : "self-promo",
        permalink: "/x",
        decidedAt: Date.now() - i * 1000,
      });
      i++;
    }
  }

  it("reports dominant outcome and consistency percentage", async () => {
    const h = fakeContext();
    await seed(h);
    const a = await analyzeDecision(
      h.context,
      "member dropped an affiliate link with a store discount promo code",
      { limit: 500, minSimilarity: 20, topK: 3 },
    );
    expect(a.consideredCount).toBe(4);
    expect(a.dominant).toBe("remove");
    expect(a.counts.remove).toBe(3);
    expect(a.counts.keep).toBe(1);
    expect(a.consistencyPct).toBe(75);
  });

  it("formats a readable Decision DNA card", async () => {
    const h = fakeContext();
    await seed(h);
    const a = await analyzeDecision(
      h.context,
      "member dropped an affiliate link with a store discount promo code",
      { limit: 500, minSimilarity: 20, topK: 3 },
    );
    const card = formatDecisionDNA(a);
    expect(card).toContain("REMOVE");
    expect(card).toContain("75%");
    expect(card).toContain("similar");
  });

  it("returns zero state when nothing matches", async () => {
    const h = fakeContext();
    await seed(h);
    const a = await analyzeDecision(
      h.context,
      "what is the best sourdough bread recipe for beginners",
      { limit: 500, minSimilarity: 30, topK: 3 },
    );
    expect(a.consideredCount).toBe(0);
    expect(a.dominant).toBeUndefined();
    expect(formatDecisionDNA(a)).toContain("No similar past decisions");
  });
});

describe("demo seed", () => {
  it("injects decisions that produce a clear Decision DNA pattern", async () => {
    const { seedDemoData, SEED_DEMO_PROBES } = await import("../seed.js");
    const h = fakeContext();
    const n = await seedDemoData(h.context);
    expect(n).toBeGreaterThanOrEqual(12);

    const a = await analyzeDecision(h.context, SEED_DEMO_PROBES[0], {
      limit: 500,
      minSimilarity: 20,
      topK: 3,
    });
    expect(a.consideredCount).toBeGreaterThan(0);
    expect(a.dominant).toBe("remove");
  });
});

describe("shadow voting → calibration", () => {
  it("shadow votes don't count toward quorum but are logged against the team decision", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    await setShadowMod(h.redis, "newmod", true);
    const s = settings({ quorumSize: 1 });

    // Shadow mod votes KEEP — should NOT resolve (shadow doesn't count).
    const shadowRes = await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "newmod", choice: "keep", reason: "looks fine" },
      s,
    );
    expect(shadowRes.resolved).toBeUndefined();
    expect((await getConclave(h.redis, "c_test1"))?.closed).toBe(false);

    // Real mod votes REMOVE — resolves, and logs the shadow divergence.
    const realRes = await submitVote(
      h.context,
      { conclaveId: "c_test1", modName: "mod1", choice: "remove", reason: "spam" },
      s,
    );
    expect(realRes.resolved).toBe("remove");

    const calib = await getCalibrationFor(h.redis, "newmod");
    expect(calib).toHaveLength(1);
    expect(calib[0].shadowChoice).toBe("keep");
    expect(calib[0].teamChoice).toBe("remove");
    expect(calib[0].agreed).toBe(false);
  });
});

describe("expiry", () => {
  it("closeExpired resolves to the plurality when votes exist", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    const s = settings({ quorumSize: 5 });
    await submitVote(h.context, { conclaveId: "c_test1", modName: "m1", choice: "warn", reason: "" }, s);
    await submitVote(h.context, { conclaveId: "c_test1", modName: "m2", choice: "warn", reason: "" }, s);
    const conclave = await getConclave(h.redis, "c_test1");
    await closeExpired(h.context, conclave!, s);
    const after = await getConclave(h.redis, "c_test1");
    expect(after?.closed).toBe(true);
    expect(after?.resolution).toBe("warn");
  });

  it("closeExpired closes with no decision when there are no votes", async () => {
    const h = fakeContext();
    await saveConclave(h.redis, makeConclave());
    const conclave = await getConclave(h.redis, "c_test1");
    await closeExpired(h.context, conclave!, settings({ quorumSize: 3 }));
    const after = await getConclave(h.redis, "c_test1");
    expect(after?.closed).toBe(true);
    expect(after?.resolution).toBeUndefined();
  });
});
