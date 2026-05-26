import { Hono } from "hono";
import type { UiResponse } from "@devvit/web/shared";
import { context, reddit } from "@devvit/web/server";
import { takePendingRoute } from "../core/target";
import { spawnConclave } from "../core/spawn";
import { loadSettings } from "../core/settings";

export const forms = new Hono();

type RouteFormValues = { reason?: string };

/** Completes the "Send to Conclave" flow started by a route-* menu action. */
forms.post("/route-submit", async (c) => {
  const user = (await reddit.getCurrentUsername()) ?? "a moderator";
  const pending = await takePendingRoute(user);
  if (!pending) {
    return c.json<UiResponse>({
      showToast: "That routing request expired. Please try again.",
    });
  }

  const { reason } = await c.req
    .json<RouteFormValues>()
    .catch(() => ({ reason: "" }));
  const note = (reason ?? "").trim() || `Manually routed by u/${user}`;

  try {
    const settings = await loadSettings();
    const result = await spawnConclave({ ...pending, reason: note }, settings);

    // navigateTo needs an absolute URL; the raw permalink is relative.
    const postId = result.conclave?.conclavePostId ?? result.postId;
    if (postId) {
      const link = `https://www.reddit.com/r/${context.subredditName}/comments/${postId.replace(/^t3_/, "")}`;
      return c.json<UiResponse>({ navigateTo: link });
    }

    // Fallback if the post id is somehow unavailable: at least confirm with a toast.
    return c.json<UiResponse>({
      showToast: {
        text: result.alreadyExisted
          ? "A Conclave is already open for this item."
          : "Conclave opened.",
        appearance: "success",
      },
    });
  } catch (e) {
    console.error("[Memex] route-submit failed:", e);
    return c.json<UiResponse>({ showToast: "Could not open the Conclave." }, 400);
  }
});

/** The Decision DNA form is display-only; closing it is a no-op. */
forms.post("/dna-ack", async (c) => {
  return c.json<UiResponse>({}, 200);
});
