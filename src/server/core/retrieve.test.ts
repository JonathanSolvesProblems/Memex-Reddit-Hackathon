import { beforeEach, describe, expect, it } from "vitest";
import { __resetStore } from "../../../test/stubs/devvit-server";
import { analyzeDecision, formatDecisionDNA, recordDecision } from "./retrieve";
import type { VoteChoice } from "../../shared/types";

beforeEach(() => __resetStore());

async function seed(id: string, content: string, action: VoteChoice, ago = 0) {
  await recordDecision({
    id,
    subredditName: "demo",
    targetKind: "post",
    contentSnippet: content,
    action,
    modName: "maya",
    reason: "affiliate self-promo",
    permalink: "",
    decidedAt: Date.now() - ago,
  });
}

describe("Decision DNA engine (integration over in-memory Redis)", () => {
  it("recognizes a consistent REMOVE pattern across paraphrased content", async () => {
    await seed("p0", "use my discount code SAVE20 for the store affiliate link in bio", "remove", 3000);
    await seed("p1", "check out my referral link discount promo for these supplements", "remove", 2000);
    await seed("p2", "i built an app link in my profile signup discount affiliate", "remove", 1000);

    const analysis = await analyzeDecision(
      "member dropped an affiliate link with a discount promo code for their store",
      { limit: 100, minSimilarity: 10, topK: 3 },
    );

    expect(analysis.consideredCount).toBeGreaterThan(0);
    expect(analysis.dominant).toBe("remove");
    expect(analysis.counts.remove).toBeGreaterThan(0);
    expect(analysis.matches[0]?.similarity).toBeGreaterThan(0);

    const dna = formatDecisionDNA(analysis);
    expect(dna).toContain("REMOVE");
    expect(dna).not.toContain("—"); // user dislikes em-dashes
  });

  it("surfaces a split when the team ruled different ways on similar content", async () => {
    await seed("s0", "is this kind of political rant actually allowed in this community", "keep", 3000);
    await seed("s1", "is this kind of political rant actually allowed here honestly", "remove", 2000);
    await seed("s2", "is this kind of political rant actually allowed please advise", "warn", 1000);

    const analysis = await analyzeDecision(
      "is this kind of political rant actually allowed in this community",
      { limit: 100, minSimilarity: 10, topK: 3 },
    );

    expect(analysis.consideredCount).toBeGreaterThanOrEqual(3);
    expect(analysis.dominant).toBeUndefined(); // 1 keep / 1 remove / 1 warn -> tie
    expect(formatDecisionDNA(analysis)).toContain("Split decision");
  });

  it("reports no precedent for unrelated content", async () => {
    await seed("u0", "use my discount code for the store affiliate link", "remove");
    const analysis = await analyzeDecision(
      "the weather forecast predicts heavy rainfall over the mountains tomorrow",
      { limit: 100, minSimilarity: 25, topK: 3 },
    );
    expect(analysis.consideredCount).toBe(0);
    expect(formatDecisionDNA(analysis)).toContain("No similar past decisions");
  });

  it("excludes a target from matching itself", async () => {
    await seed("dup", "identical affiliate discount promo code store link", "remove");
    const analysis = await analyzeDecision(
      "identical affiliate discount promo code store link",
      { limit: 100, minSimilarity: 10, topK: 3, excludeTargetIds: ["dup"] },
    );
    expect(analysis.consideredCount).toBe(0);
  });
});
