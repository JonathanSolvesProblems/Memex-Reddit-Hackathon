# Memex — Privacy Policy

_Last updated: May 26, 2026_

Memex is a moderation tool for Reddit communities, built on the Reddit Developer
Platform (Devvit). This policy explains what data it handles.

## What Memex stores

Memex stores moderation data inside Reddit's own per-subreddit storage (Redis),
scoped to the single subreddit where it is installed:

- moderation decisions (a short content snippet, the outcome, the acting mod, and
  the reason given) used as precedent for Decision DNA;
- open decision rooms ("Conclaves"), their votes, and shadow-mode calibration logs;
- a transient presence record of who is currently viewing a decision room.

This data never leaves the subreddit's storage and is **not** shared across
subreddits. Memex does **not** train any machine-learning model on Reddit data.
The default similarity engine is fixed local computation with no external calls.

## Optional semantic matching (off by default)

Memex includes an **optional** semantic-matching feature that is **disabled by
default**. A subreddit only activates it if a moderator turns on the "Semantic
matching" setting **and** the developer has configured an OpenAI API key.

When (and only when) it is enabled:

- the text of the content being analyzed is sent to the OpenAI Embeddings API
  (`api.openai.com`) to compute a numeric embedding;
- OpenAI returns a vector, which Memex caches in the subreddit's Redis to avoid
  repeat calls;
- OpenAI's handling of API data is governed by their own policies. As of this
  writing, OpenAI does not train on data submitted via its API.

If the feature is disabled (the default), **no content is ever sent to any
external service** and Memex operates fully on-platform.

## Data retention and deletion

Cached embeddings expire automatically. Seeded demo data can be removed at any
time from the mod menu ("Clear demo data"). Uninstalling the app removes Memex's
access to the subreddit. To request deletion of stored decision data, contact the
developer.

## Contact

Questions about this policy: **hello@n2.help**
