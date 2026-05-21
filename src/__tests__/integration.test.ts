import { describe, it, expect } from "vitest";
import { fakeContext, type FakeReddit, type FakeRedis } from "./fakes.js";
import {
  saveConclave,
  getConclave,
  getCalibrationFor,
  setShadowMod,
} from "../redis.js";
import { submitVote, closeExpired } from "../conclave/vote.js";
import { recordDecision, findPrecedents } from "../precedent/retrieve.js";
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

type Harness = {
  redis: FakeRedis;
  reddit: FakeReddit;
  context: never;
};

describe("vote → resolve → execute", () => {
  it("REMOVE at quorum removes the post and closes the room", async () => {
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
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

  it("does NOT resolve below quorum", async () => {
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
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

  it("does not surface unrelated content", async () => {
    const h = fakeContext() as Harness;
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

describe("shadow voting → calibration", () => {
  it("shadow votes don't count toward quorum but are logged against the team decision", async () => {
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
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
    const h = fakeContext() as Harness;
    await saveConclave(h.redis, makeConclave());
    const conclave = await getConclave(h.redis, "c_test1");
    await closeExpired(h.context, conclave!, settings({ quorumSize: 3 }));
    const after = await getConclave(h.redis, "c_test1");
    expect(after?.closed).toBe(true);
    expect(after?.resolution).toBeUndefined();
  });
});
