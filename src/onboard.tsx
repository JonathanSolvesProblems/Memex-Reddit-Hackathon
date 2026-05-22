import { Devvit } from "@devvit/public-api";
import type { TriggerContext } from "@devvit/public-api";

const ONBOARD_FLAG = "memex:onboarded";

/**
 * Runs once on first install: pins a Living Rulebook hub post and sends a
 * setup modmail. Guarded by a Redis flag so app upgrades don't re-trigger it.
 */
export async function runOnboarding(context: TriggerContext): Promise<void> {
  const already = await context.redis.get(ONBOARD_FLAG);
  if (already) return;
  await context.redis.set(ONBOARD_FLAG, "1");

  let subName: string;
  try {
    subName = await context.reddit.getCurrentSubredditName();
  } catch {
    return;
  }

  // Pin a Living Rulebook hub post.
  try {
    const post = await context.reddit.submitPost({
      title: "Memex — Living Rulebook",
      subredditName: subName,
      preview: (
        <vstack alignment="middle center" grow padding="medium">
          <text size="medium">Loading Memex…</text>
        </vstack>
      ),
    });
    await context.redis.set(`rulebook-post:${post.id}`, "1");
    try {
      await post.sticky(1);
    } catch {
      // stickying is best-effort (slot may be full)
    }
  } catch {
    // ignore — onboarding is best-effort
  }

  // Send a setup modmail.
  try {
    const sub = await context.reddit.getSubredditByName(subName);
    await context.reddit.modMail.createModInboxConversation({
      subredditId: sub.id,
      subject: "Welcome to Memex 🧬",
      bodyMarkdown: [
        "Memex is your mod team's memory. Three quick steps to start:",
        "",
        "1. **Set your quorum size** — Mod Tools → Memex → Settings. Use 1 to test solo; 3+ for a team.",
        "2. **Try Decision DNA** — open the `...` menu on any post or comment → *Memex: Decision DNA*. It shows how your team has ruled on similar content.",
        "3. **Send a borderline item to a Conclave** — `...` menu → *Memex: Send to Conclave*. Your team votes async; consensus auto-executes (bans always need a human click).",
        "",
        "Every decision becomes searchable team memory in the pinned **Living Rulebook**.",
        "",
        "Tip: onboard new mods in shadow mode (subreddit menu → *Memex: Toggle shadow mode*) so they calibrate to your team's standards.",
      ].join("\n"),
    });
  } catch {
    // ignore
  }
}
