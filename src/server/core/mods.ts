import { context, reddit } from "@devvit/web/server";

/**
 * Whether the current request's user is a moderator of this subreddit. Used to
 * gate vote-casting from the webview (menu actions are already mod-gated by
 * `forUserType: "moderator"` in devvit.json, but the post webview is visible to
 * anyone who can see the post).
 *
 * Permissive on error: if the permission lookup itself fails we allow the action
 * rather than locking moderators out of their own tool, and log it.
 */
export async function isCurrentUserMod(): Promise<boolean> {
  try {
    const user = await reddit.getCurrentUser();
    if (!user) return false;
    const perms = await user.getModPermissionsForSubreddit(
      context.subredditName,
    );
    return perms.length > 0;
  } catch (e) {
    console.error(
      "[Memex] moderator check failed, allowing:",
      e instanceof Error ? e.message : String(e),
    );
    return true;
  }
}
