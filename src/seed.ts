import type { TriggerContext } from "@devvit/public-api";
import { recordDecision } from "./precedent/retrieve.js";
import type { TargetKind, VoteChoice } from "./types.js";

type Seed = {
  content: string;
  action: VoteChoice;
  reason: string;
  mod: string;
  kind?: TargetKind;
};

const MODS = ["maya", "devon", "priya", "sam"];

/**
 * Realistic, clustered demo decisions so Decision DNA and the Living Rulebook
 * show meaningful consistency scores and precedent matches instead of empty
 * states. Clusters are tuned to produce both high-consistency patterns and a
 * genuinely-borderline (low consistency) one.
 */
const SEEDS: Seed[] = [
  // Affiliate / self-promo cluster — strongly REMOVE (with one KEEP dissent)
  {
    content:
      "check out my store use code SAVE20 for a discount on these supplements affiliate link in bio",
    action: "remove",
    reason: "affiliate self-promo",
    mod: "maya",
  },
  {
    content:
      "i built an app that solves exactly this problem, link in my profile, would love your feedback and signups",
    action: "remove",
    reason: "self-promotion",
    mod: "devon",
  },
  {
    content:
      "honestly this product changed my life here is my referral link you get a discount too",
    action: "remove",
    reason: "affiliate spam",
    mod: "priya",
  },
  {
    content:
      "selling my old gear dm me with offers, discount for this sub members only",
    action: "remove",
    reason: "no marketplace posts",
    mod: "sam",
  },
  {
    content:
      "i made a free open source tool for this, no signup no ads, sharing in case it helps anyone here",
    action: "keep",
    reason: "genuine free contribution, not promo",
    mod: "maya",
  },

  // Civility cluster — genuinely borderline (mixed outcomes -> low consistency)
  {
    content:
      "this take is absolutely braindead how are you people even this clueless about it",
    action: "remove",
    reason: "personal attack / incivility",
    mod: "devon",
  },
  {
    content:
      "strong disagree, that argument falls apart the moment you look at the actual data, here's why",
    action: "keep",
    reason: "heated but on-topic and substantive",
    mod: "priya",
  },
  {
    content:
      "people who genuinely believe this are honestly part of the problem with this community",
    action: "warn",
    reason: "borderline generalization, warned",
    mod: "sam",
  },
  {
    content:
      "you clearly have no clue what you are talking about, this is embarrassing to read",
    action: "remove",
    reason: "personal attack",
    mod: "maya",
  },

  // Low-effort / karma farming — REMOVE
  {
    content: "upvote if you agree!! let's get this to the front page",
    action: "remove",
    reason: "low-effort karma farming",
    mod: "devon",
    kind: "comment",
  },
  {
    content: "first!! lol",
    action: "remove",
    reason: "low-effort",
    mod: "priya",
    kind: "comment",
  },
  {
    content:
      "not really about this sub topic but i thought this meme was too funny not to share here",
    action: "remove",
    reason: "off-topic",
    mod: "sam",
  },

  // Safety / misinformation — ESCALATE / REMOVE
  {
    content:
      "you do not need a doctor for that, just take very high doses of this supplement daily and it cures it",
    action: "escalate",
    reason: "medical misinformation, escalated to senior mods",
    mod: "maya",
  },
  {
    content:
      "here is the full name and home address of the person who posted that, do what you want with it",
    action: "remove",
    reason: "doxxing / personal information",
    mod: "devon",
  },

  // Good-faith newcomer — KEEP
  {
    content:
      "new here sorry if this has been asked before but how does the verification process actually work",
    action: "keep",
    reason: "good-faith newcomer question",
    mod: "priya",
  },

  // Genuinely SPLIT cluster — near-identical wording, divided outcomes. The
  // team has handled "is this political rant allowed" inconsistently, so
  // Decision DNA should report a split (no dominant outcome).
  {
    content:
      "is this kind of political rant actually allowed in this community or not",
    action: "keep",
    reason: "on-topic per rule 2",
    mod: "maya",
  },
  {
    content:
      "is this kind of political rant actually allowed in this community honestly",
    action: "remove",
    reason: "off-topic political content",
    mod: "devon",
  },
  {
    content:
      "is this kind of political rant actually allowed in this community please advise",
    action: "warn",
    reason: "borderline, warned the user",
    mod: "priya",
  },
];

export async function seedDemoData(
  context: Pick<TriggerContext, "redis">,
): Promise<number> {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  let i = 0;
  for (const s of SEEDS) {
    await recordDecision(context.redis, {
      id: `seed_${now.toString(36)}_${i}`,
      subredditName: "demo",
      targetKind: s.kind ?? "post",
      contentSnippet: s.content,
      action: s.action,
      modName: s.mod ?? MODS[i % MODS.length],
      reason: s.reason,
      permalink: "",
      decidedAt: now - (SEEDS.length - i) * 6 * hour,
    });
    i++;
  }
  return SEEDS.length;
}

/** Probe phrases a demo can run Decision DNA against to show clear patterns. */
export const SEED_DEMO_PROBES = [
  // High-consistency REMOVE
  "member dropped an affiliate link with a discount promo code for their store",
  // Split decision (no dominant outcome)
  "is this kind of political rant actually allowed in this community",
  // Escalate
  "just take megadoses of this supplement instead of seeing a doctor",
];
