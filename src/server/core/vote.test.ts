import { beforeEach, describe, expect, it } from "vitest";
import { __resetStore } from "../../../test/stubs/devvit-server";
import { spawnConclave } from "./spawn";
import { submitVote } from "./vote";
import { getConclave, setShadowMod } from "./redis";
import { analyzeDecision } from "./retrieve";
import { DEFAULT_SETTINGS } from "./settings";

const settings = { ...DEFAULT_SETTINGS, quorumSize: 2 };

beforeEach(() => __resetStore());

async function openConclave() {
  const res = await spawnConclave(
    {
      subredditName: "demo",
      targetKind: "post",
      targetId: "t3_target",
      authorName: "author",
      contentSnippet: "affiliate discount promo code store referral link in bio",
      permalink: "",
      openedBy: "maya",
      reason: "suspected affiliate spam",
    },
    settings,
  );
  return res.conclave!.id;
}

describe("Conclave vote pipeline (integration over in-memory Redis)", () => {
  it("resolves at quorum, applies the outcome, and records a precedent", async () => {
    const id = await openConclave();

    const first = await submitVote(
      { conclaveId: id, modName: "maya", choice: "remove", reason: "spam" },
      settings,
    );
    expect(first.ok).toBe(true);
    expect(first.resolved).toBeUndefined(); // 1/2, not yet

    const second = await submitVote(
      { conclaveId: id, modName: "devon", choice: "remove", reason: "affiliate" },
      settings,
    );
    expect(second.resolved).toBe("remove"); // quorum reached

    const conclave = await getConclave(id);
    expect(conclave?.closed).toBe(true);
    expect(conclave?.resolution).toBe("remove");

    // The team's decision is now a precedent: similar content surfaces it.
    const analysis = await analyzeDecision(
      "member dropped an affiliate referral link with a discount promo code",
      { limit: 100, minSimilarity: 10, topK: 3 },
    );
    expect(analysis.counts.remove).toBeGreaterThan(0);
    expect(analysis.dominant).toBe("remove");
  });

  it("does not let shadow votes count toward quorum", async () => {
    const id = await openConclave();
    await setShadowMod("trainee", true);

    const shadow = await submitVote(
      { conclaveId: id, modName: "trainee", choice: "remove", reason: "" },
      settings,
    );
    expect(shadow.resolved).toBeUndefined();

    const real = await submitVote(
      { conclaveId: id, modName: "maya", choice: "remove", reason: "" },
      settings,
    );
    expect(real.resolved).toBeUndefined(); // still only 1 real vote of 2

    const conclave = await getConclave(id);
    expect(conclave?.closed).toBe(false);
  });

  it("rejects voting on a closed conclave", async () => {
    const id = await openConclave();
    await submitVote({ conclaveId: id, modName: "a", choice: "keep", reason: "" }, settings);
    await submitVote({ conclaveId: id, modName: "b", choice: "keep", reason: "" }, settings);

    const late = await submitVote(
      { conclaveId: id, modName: "c", choice: "remove", reason: "" },
      settings,
    );
    expect(late.ok).toBe(false);
    expect(late.message).toMatch(/closed/i);
  });

  it("is idempotent per target: re-routing returns the existing conclave", async () => {
    const id = await openConclave();
    const again = await spawnConclave(
      {
        subredditName: "demo",
        targetKind: "post",
        targetId: "t3_target",
        authorName: "author",
        contentSnippet: "whatever",
        permalink: "",
        openedBy: "devon",
        reason: "again",
      },
      settings,
    );
    expect(again.alreadyExisted).toBe(true);
    expect(again.conclave?.id).toBe(id);
  });
});
