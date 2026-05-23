# Memex

**The only Reddit mod tool with institutional memory.** Memex remembers how
your team decided before, surfaces it at the moment you decide again, and keeps
new mods consistent with the team's actual standards.

Most mod tools make one mod faster at clearing a queue. Memex makes the *team*
decide consistently over time — and stops that knowledge from walking out the
door when a veteran mod leaves.

## The three layers

### 1. Decision DNA (the headline)
On **any** post or comment, one click shows how your team has historically
ruled on similar content: the dominant outcome, a **consistency score**, and
the closest past decisions. Inside a decision room it renders as a live banner
("Team usually: REMOVE · 80% consistent · 5 similar decisions on record").

Low consistency is itself a signal — it flags genuinely borderline content that
deserves a team vote rather than a lone call.

Built on **local trigram/token similarity** — no external API, no API key, no
per-comment cost, no domain-approval bottleneck. It works the instant it's
installed and scales from a 200-member sub to a 5M-member one.

### 2. Conclave (async team decisions)
Borderline items become mod-only decision rooms. Mods vote
`Remove | Keep | Warn | Escalate`; when quorum is reached, the consensus action
auto-executes for reversible actions. **Bans never auto-execute** — they
surface as a recommendation requiring a human click (per Reddit's 2026 admin
policy on ban bots). Votes and quorum update **live** (a lightweight poll) across every mod viewing
the room, with a presence indicator showing who else is reviewing.

### 3. Calibration (consistent onboarding)
New mods cast **shadow votes** that are logged but don't count toward quorum. A
weekly digest shows where they diverged from team consensus and why — so they
absorb the team's standards instead of guessing for six months.

## Why it's defensibly different

The "shared mod workspace / coordination" space is crowded. Memex's
**institutional-memory layer is not**: no other tool surfaces *how your team
decided on similar content* at decision time, scores decision consistency, or
calibrates new mods against the team's real pattern. The voting + live updates
are the delivery mechanism; the memory is the moat.

## Rule compliance

- **No automated bans** — bans require a human click.
- **No ML training on Reddit data** — similarity is fixed local computation.
- **No external calls** — no API keys, no domain allow-listing, zero cost.
- **Per-subreddit isolation** — no Global Redis, no cross-sub data sharing.
- **Mod-only data exposure** — Conclave rooms and Decision DNA are mods-only.

## Project layout

```
src/
  main.tsx                # entry; registers post type, triggers, scheduler, menu
  post.tsx                # the custom post: Conclave room + Living Rulebook (one dispatcher)
  menu.tsx                # Send to Conclave, Decision DNA, shadow toggle, open Rulebook
  settings.ts             # mod-configurable settings
  types.ts                # shared types
  redis.ts                # persistence: conclaves, votes, precedents, calibration
  conclave/               # routing, vote tally + consensus execution, room spawn
  precedent/              # tokenize + similarity, analyzeDecision (Decision DNA), retrieval
  calibration/            # weekly divergence digest
  triggers.ts             # event handlers
  __tests__/              # 35 tests: logic + full pipeline against in-memory fakes
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

Core verified live on Reddit infra and in 35 automated tests (vote → quorum →
consensus execution → precedent recording → Decision DNA retrieval →
calibration logging). Typecheck and tests green.
