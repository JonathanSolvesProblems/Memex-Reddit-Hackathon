# Quorum

The team-decision layer for Reddit moderation.

Reddit's modqueue treats every mod as a lone agent. Quorum treats the mod team
as a single distributed brain.

## What it does

Three layers, one Devvit app:

1. **Conclave** — borderline queue items become async, mod-only decision rooms.
   Mods vote `Remove | Keep | Warn | Escalate`. After quorum or timeout, the
   consensus action auto-executes for reversible actions. Bans never
   auto-execute — they surface as recommendations for a human click (per the
   2026 Reddit admin policy on ban bots).

2. **Precedent Engine** — every mod action is vectorized into a per-subreddit
   index. New queue items surface the 3 most similar past decisions. A Living
   Rulebook view shows the team's actual decision pattern, not just the
   written rules.

3. **Calibration Mode** — new mods cast shadow votes that don't count for
   quorum but get logged. Weekly digest shows where they diverged from team
   consensus, and why.

## Why it's net-new

No Devvit app today does async team voting on queue items. No Devvit app
retrieves past-decision precedents. Both are firsts. The premise — that the
bottleneck is decision legitimacy and team coherence, not reading speed — is
sociological, not just tooling.

## Rule compliance

- No auto-ban — bans require human click.
- No ML training on Reddit data — embeddings via fixed off-the-shelf models.
- Per-subreddit isolation — no cross-sub data sharing.
- Mod-only data exposure — Conclave rooms are private to mods.
- Clearly scoped permissions in `devvit.json`.

## Project layout

```
src/
  main.tsx                # entry, registers everything
  settings.ts             # mod-configurable settings
  types.ts                # shared types
  redis/                  # all persistence: keys, votes, precedents, calibration
  conclave/               # Layer 1: routing, room UI, vote/tally/execute
  precedent/              # Layer 2: embed, retrieve, panel, Living Rulebook
  calibration/            # Layer 3: shadow voting, weekly digest
  triggers/               # event handlers wired in main.tsx
  schedulers.ts           # scheduled job definitions
```

## Development

```sh
npm install
npm run login         # one-time, devvit auth
npm run playtest      # iterate against a test subreddit
npm run typecheck
```
