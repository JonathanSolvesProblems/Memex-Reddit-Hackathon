import { reddit } from "@devvit/web/server";
import { markRulebookPost, setCurrentRulebookPost } from "./redis";

/**
 * Creates the Living Rulebook post: the always-on dashboard surface for a
 * subreddit's institutional memory. There's a single custom-post type; the
 * client decides what to render by asking the server to classify the post, so
 * here we just create it and tag it as the rulebook in Redis.
 */
export const createRulebookPost = async () => {
  const post = await reddit.submitCustomPost({
    title: "Memex — Living Rulebook",
  });
  await markRulebookPost(post.id);
  await setCurrentRulebookPost(post.id);
  return post;
};
