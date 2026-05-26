# Memex · institutional memory for mod teams

![tests](https://img.shields.io/badge/tests-50_passing-brightgreen)
![built on](https://img.shields.io/badge/built_on-Devvit_Web-FF4500)
![stack](https://img.shields.io/badge/React_19-Hono-blue)
![semantic search](https://img.shields.io/badge/semantic_search-optional-8A2BE2)

**The only Reddit mod tool with institutional memory.** Memex remembers how your
team decided before, surfaces it at the moment you decide again, and keeps new
mods consistent with the team's actual standards.

Most mod tools make one mod faster at clearing a queue. Memex makes the *team*
decide consistently over time, and stops that knowledge from walking out the
door when a veteran mod leaves.

- **App:** https://developers.reddit.com/apps/memex-mod
- **Built on:** Devvit Web (Reddit Developer Platform) · React 19 · Tailwind · Hono · Redis · TypeScript
- **Category:** New Mod Tool · Reddit Mod Tools & Migrated Apps Hackathon

> **Migrated from Blocks to Devvit Web to stay compliant.** Memex was first built on
> Devvit Blocks. Days before the deadline I learned the Blocks custom-post renderer is
> being retired (custom posts disabled June 30, 2026), so rather than ship something
> that would stop working, I rebuilt the entire app on the new Devvit Web platform: a
> React 19 webview over a Hono server, with the whole decision engine ported intact.
> This keeps Memex compliant and working past the Blocks sunset. The original Blocks
> build is preserved on the
> [`blocks-backup`](https://github.com/JonathanSolvesProblems/Memex-Reddit-Hackathon/tree/blocks-backup)
> branch for reference. The new server runtime also unlocked an optional
> semantic-matching layer (see below).

## Demo

A Conclave decision room — Decision DNA, a live quorum vote, and the resolved outcome:

![Memex Conclave decision room](https://raw.githubusercontent.com/JonathanSolvesProblems/Memex-Reddit-Hackathon/main/screenshots/conclave.png)

The Living Rulebook — impact stats, 14-day activity, outcome mix, and the phrase tester:

![Memex Living Rulebook dashboard](https://raw.githubusercontent.com/JonathanSolvesProblems/Memex-Reddit-Hackathon/main/screenshots/rulebook.png)

**1-minute demo video:** _add the YouTube link here once it's uploaded._

---

## What it does

### Decision DNA (the headline)
On **any** post or comment, Memex shows how your team has historically ruled on
similar content: the **dominant outcome**, a **consistency score**, and the
closest past decisions with the reasons mods gave. Inside a decision room it
renders as a live panel ("Dominant: REMOVE · 80% consistent · 5 similar
decisions"). Low consistency is itself a signal: it flags genuinely borderline
content that deserves a team decision rather than a lone call, and shows a
**"Split decision"** state when outcomes tie.

It works across post types: text (title + body), **link posts (title + domain,
so repeat spam/affiliate domains are recognized)**, and image/video/poll (title).
The default engine is **local trigram + token similarity**: no external API, no
key, no per-comment cost. It runs the instant it's installed, on any sub size, in
any language.

### Semantic matching (optional, opt-in, multi-provider)
Now that the app runs on a real server, a subreddit can optionally enable
embedding-based similarity, blended on top of the local engine, to catch
paraphrases the lexical engine misses ("promo code for my shop" vs "discount link
to my store"). Paste an API key and Memex **auto-detects the provider** from its
shape (OpenAI `sk-...`, Google Gemini `AIza...`); the provider layer is
vendor-agnostic and easy to extend. It is **off by default**, and with the toggle
off or no key Memex never makes an external call (pure local, no errors). A
mistyped key is caught on save, and the dashboard reminds you to add one if the
toggle is on without a key. Any failure falls back to the local engine, so the
tool stays fully functional and private out of the box. See [PRIVACY.md](https://github.com/JonathanSolvesProblems/Memex-Reddit-Hackathon/blob/main/PRIVACY.md).

### Conclave (async team decisions)
Borderline items become mod-only decision rooms. Mods vote
`Remove | Keep | Warn | Escalate` (pick a choice and add an optional reason);
when quorum is reached the consensus action auto-executes for reversible actions.
**Bans never auto-execute**: they surface as a recommendation requiring a human
click (per Reddit's 2026 admin policy on ban bots). Votes, the quorum meter, and a
"who's reviewing" presence indicator update **live** for everyone in the room.

### Living Rulebook (searchable team memory)
A custom post showing the team's *applied* rules (not just the written ones),
with **impact stats** (total decisions, decisions this week, open conclaves), a
proportional outcome bar, a 14-day activity sparkline, the open conclaves, and
recent precedents. It includes a **"test a phrase"** tool: paste any content and
instantly see the Decision DNA the team would surface for it.

### Calibration (consistent onboarding)
New mods cast **shadow votes** that are logged but don't count toward quorum. A
weekly digest (or one sent on demand from the mod menu) shows where they diverged
from team consensus and why, so they absorb the team's standards in weeks.

### Consistency Sweep (retrospective audit)
On demand or **on a schedule**, Memex scans recent live posts and flags ones
similar to content the team has **REMOVED before but are still up**, using the
team's own past decisions as the baseline (no rules to define). Flagged items are
**reported into the modqueue** (never auto-removed) with a Memex reason, plus a
modmail summary. This catches what the team missed.

### Plus
- **Learns from every action:** every native remove/approve a mod takes is
  recorded as a precedent (via the ModAction trigger), so Decision DNA reflects
  the whole team's real behavior, not just Conclave outcomes.
- **Native mod-notes:** every team decision is written to Reddit's own mod-note
  timeline, so the memory is visible even outside the app.
- **Auto-routing:** optionally route new content to a Conclave by keyword or
  account age.
- **Demo data:** a mod-menu action seeds (or clears) realistic decisions for
  evaluation; seeding is idempotent, so re-running resets the demo set.

## Why it's defensibly different

The "shared mod workspace / coordination" space is crowded. Memex's
**institutional-memory layer is not**: no other Devvit app surfaces *how your team
decided on similar content* at decision time, scores decision consistency, or
calibrates new mods against the team's real pattern. The voting and live updates
are the delivery mechanism; the memory is the moat.

## Devvit Rules compliance

- **No automated bans:** bans require a human click.
- **Local-first, private by default:** the matching engine is fixed local
  computation. The optional semantic layer is opt-in, off by default, and
  documented in [PRIVACY.md](https://github.com/JonathanSolvesProblems/Memex-Reddit-Hackathon/blob/main/PRIVACY.md). No Reddit data is used to train models.
- **Per-subreddit isolation:** per-subreddit Redis, no cross-sub data sharing.
- **Mod-only data exposure:** Conclave voting and mod actions are gated to
  moderators server-side.

## How it works

A single custom-post type renders both surfaces: an **inline splash card** in the
feed and an **expanded React webview**. The server classifies each post (Conclave
vs Living Rulebook) and returns the right snapshot. State lives in per-subreddit
**Redis** (conclaves, votes, precedents, calibration logs, presence). Decision DNA
scores candidates with batched (`mGet`) local trigram + token Jaccard similarity,
optionally blended with cached embedding cosine. Live updates and presence run on
a lightweight client poll backed by a Redis sorted set.

```
src/
  client/                  React 19 webview (Vite + Tailwind 4)
    splash.tsx             inline feed card (default entrypoint)
    game.tsx               expanded view: Conclave room or Living Rulebook
    components/            ConclaveRoom, RulebookDashboard, DnaPanel, ProbeTool
    hooks/useInit.ts       post classification + initial snapshot
    api.ts, ui.tsx
  server/                  Hono server on @devvit/web/server
    index.ts               mounts /api + /internal/{menu,form,triggers,scheduler}
    routes/                api, menu, forms, triggers, scheduler endpoints
    core/
      embed.ts             tokenize + trigram/token similarity (local default)
      semantic.ts          optional OpenAI-embedding layer (opt-in, cached)
      retrieve.ts          recordDecision + analyzeDecision (Decision DNA)
      redis.ts             persistence (conclaves, votes, precedents, presence)
      vote.ts spawn.ts router.ts audit.ts digest.ts seed.ts
      stats.ts views.ts settings.ts post.ts mods.ts target.ts
  shared/                  types + API contract shared by client and server
devvit.json                post, server, menu, forms, triggers, scheduler, settings, permissions
```

## Development

```sh
npm install
npm run login                # one-time devvit auth
npm run dev                  # devvit playtest against a <200-member sub you mod
npm run type-check
npm test
npm run build
```

## Status

Core engine verified by **50 automated tests** (tokenization, link-domain
matching, similarity, Decision DNA retrieval incl. split detection and self-
exclusion, the full Conclave vote → quorum → resolve → precedent pipeline,
shadow-vote exclusion, settings parsing, embedding-provider detection, auto-route
rules, sweep flagging, and semantic cosine + blend rescaling) running against an
in-memory Redis. TypeScript
type-check, ESLint (0 warnings), the Vite production build, and the full test
suite are all green.
