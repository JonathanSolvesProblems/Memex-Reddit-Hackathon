import { context, redis, reddit } from "@devvit/web/server";
import { T1, T3 } from "@devvit/web/shared";
import { buildPostSnippet } from "./embed";
import type { SpawnInput } from "./spawn";

const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingKey = (user: string) => `route:pending:${user}`;

/** Builds the Conclave spawn input for a post target (menu/trigger/auto-route). */
export async function spawnInputForPost(
  postId: string,
  openedBy: string,
  reason: string,
): Promise<SpawnInput> {
  const post = await reddit.getPostById(T3(postId));
  return {
    subredditName: context.subredditName,
    targetKind: "post",
    targetId: post.id,
    authorName: post.authorName,
    contentSnippet: buildPostSnippet({
      title: post.title,
      body: post.body,
      url: post.url,
    }),
    permalink: post.permalink,
    openedBy,
    reason,
  };
}

/** Builds the Conclave spawn input for a comment target. */
export async function spawnInputForComment(
  commentId: string,
  openedBy: string,
  reason: string,
): Promise<SpawnInput> {
  const comment = await reddit.getCommentById(T1(commentId));
  return {
    subredditName: context.subredditName,
    targetKind: "comment",
    targetId: comment.id,
    authorName: comment.authorName,
    contentSnippet: comment.body,
    permalink: comment.permalink,
    openedBy,
    reason,
  };
}

/**
 * Parks a half-built spawn input between a menu action and its reason form. The
 * form submit runs in the same moderator's context, so we key it by username
 * and expire it quickly. Survives the form-data round-trip regardless of how
 * the platform threads `data` through.
 */
export async function stashPendingRoute(
  user: string,
  input: SpawnInput,
): Promise<void> {
  await redis.set(pendingKey(user), JSON.stringify(input), {
    expiration: new Date(Date.now() + PENDING_TTL_MS),
  });
}

export async function takePendingRoute(
  user: string,
): Promise<SpawnInput | undefined> {
  const raw = await redis.get(pendingKey(user));
  if (!raw) return undefined;
  await redis.del(pendingKey(user));
  return JSON.parse(raw) as SpawnInput;
}
