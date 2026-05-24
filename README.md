# Memex · institutional memory for mod teams

**The only Reddit mod tool with institutional memory.** Memex remembers how your
team decided before, surfaces it at the moment you decide again, and keeps new
mods consistent with the team's actual standards.

Most mod tools make one mod faster at clearing a queue. Memex makes the *team*
decide consistently over time, and stops that knowledge from walking out the
door when a veteran mod leaves.

- **App:** https://developers.reddit.com/apps/memex-mod
- **Built on:** Devvit (Reddit Developer Platform), TypeScript, Redis
- **Category:** New Mod Tool · Reddit Mod Tools & Migrated Apps Hackathon

---

## What it does

### Decision DNA (the headline)
On **any** post or comment, one click shows how your team has historically ruled
on similar content: the **dominant outcome**, a **consistency score**, and the
closest past decisions with the reasons mods gave. Inside a decision room it
renders as a live banner ("Team usually: REMOVE · 80% consistent · 5 similar
decisions on record"). Low consistency is itself a signal: it flags genuinely
borderline content that deserves a team decision rather than a lone call, and
shows a **"Split decision"** state when outcomes tie.

It works across post types: text (title + body), **link posts (title + domain,
so repeat spam/affiliate domains are recognized)**, and image/video/poll (title).
Built on **local trigram/token similarity**: no external API, no API key, no
per-comment cost. It runs the instant it's installed, on any sub size, in any
language.

### Conclave (async team decisions)
Borderline items become mod-only decision rooms. Mods vote
`Remove | Keep | Warn | Escalate` (tap a choice to confirm and add an optional
reason); when quorum is reached the consensus action auto-executes for
reversible actions. **Bans never auto-execute**: they surface as a
recommendation requiring a human click (per Reddit's 2026 admin policy on ban
bots). Votes, the quorum meter, and a "who's reviewing" presence indicator
update **live** for everyone viewing the room.

### Living Rulebook (searchable team memory)
Every resolved decision becomes part of a pinned custom post showing the team's
*applied* rules (not just the written ones), with **impact stats** (total
decisions, decisions this week, open conclaves), a proportional outcome bar, and
a 7-day activity sparkline. It's interactive: **tap an outcome to filter**,
**page through** all decisions, and **tap any decision** for its full detail.

### Calibration (consistent onboarding)
New mods cast **shadow votes** that are logged but don't count toward quorum. A
weekly digest (or one sent on demand from the mod menu) shows where they
diverged from team consensus and why, so they absorb the team's standards in
weeks instead of months.

### Consistency Sweep (retrospective audit)
On demand or **automatically once a day**, Memex scans recent live posts and
flags ones similar to content the team has **REMOVED before but are still up**,
using the team's own past decisions as the baseline (no rules to define, no AI).
Flagged items are **reported into the modqueue** (never auto-removed) with a
Memex reason, plus a modmail summary. Intensity is a single dial (minimum past
consistency to flag). This catches what the team missed.

### Plus
- **Native mod-notes:** every team decision is written to Reddit's own mod-note
  timeline, so the memory is visible even outside the app.
- **Appeal assist:** when a user messages modmail, Memex adds an internal,
  mod-only note with the Decision DNA for that content so the team responds
  consistently.
- **First-run onboarding:** on install, pins a Living Rulebook hub and sends a
  setup modmail.
- **Auto-routing:** optionally route new content to a Conclave by keyword or
  account age.
- **Demo seed:** a mod menu action populates realistic decisions for evaluation.

## Why it's defensibly different

The "shared mod workspace / coordination" space is crowded. Memex's
**institutional-memory layer is not**: no other Devvit app surfaces *how your
team decided on similar content* at decision time, scores decision consistency,
or calibrates new mods against the team's real pattern. The voting and live
updates are the delivery mechanism; the memory is the moat.

## Devvit Rules compliance

- **No automated bans:** bans require a human click.
- **No ML training on Reddit data:** similarity is fixed local computation.
- **No external calls:** no API keys, no domain allow-listing, zero cost.
- **Per-subreddit isolation:** no Global Redis, no cross-sub data sharing.
- **Mod-only data exposure:** Conclave rooms and Decision DNA are mods-only.

## How it works

A single custom-post dispatcher renders both the Conclave room and the Living
Rulebook. State lives in per-subreddit Redis (conclaves, votes, precedents,
calibration logs, presence). Decision DNA scores candidates with batched
(`mGet`) local trigram + token Jaccard similarity. Live updates and presence run
on a lightweight 2s `useInterval` poll backed by a Redis sorted set.

```
src/
  main.tsx        # entry; registers the post type, triggers, scheduler, menu
  post.tsx        # custom post: Conclave room + Living Rulebook (one dispatcher)
  menu.tsx        # Send to Conclave, Decision DNA, shadow toggle, Rulebook, seed
  settings.ts     # mod-configurable settings
  redis.ts        # persistence: conclaves, votes, precedents, calibration, presence
  conclave/       # routing, vote tally + consensus execution, room spawn
  precedent/      # tokenize + similarity, analyzeDecision (Decision DNA), retrieval
  calibration/    # weekly divergence digest
  audit.ts        # consistency sweep (retrospective precedent audit)
  stats.ts        # pure helpers for the Rulebook visuals
  onboard.tsx     # first-run onboarding
  triggers.ts     # PostSubmit / CommentSubmit / ModAction / ModMail / install
  seed.ts         # demo data
  __tests__/      # 55 tests: logic + full pipeline against in-memory fakes
```

## Development

```sh
npm install
npm run login                       # one-time devvit auth
npm run playtest <your-test-sub>    # iterate against a <200-member sub you mod
npm run typecheck
npm run test
```

## Status

Core flows verified live on Reddit and by **55 automated tests** (vote, quorum,
consensus execution, precedent recording, Decision DNA retrieval, split
detection, link-domain matching, calibration logging). TypeScript typecheck and
the full suite are green. Destructive paths are guarded against
deleted/already-actioned targets; reads are bounded for scale.
