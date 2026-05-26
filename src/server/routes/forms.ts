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

    if (result.alreadyExisted) {
      const link = result.conclave?.conclavePostId
        ? `https://www.reddit.com/r/${context.subredditName}/comments/${result.conclave.conclavePostId.replace(/^t3_/, "")}`
        : undefined;
      return c.json<UiResponse>({
        showToast: "A Conclave is already open for this item.",
        ...(link ? { navigateTo: link } : {}),
      });
    }

    return c.json<UiResponse>({
      showToast: { text: "Conclave opened.", appearance: "success" },
      ...(result.conclavePostUrl ? { navigateTo: result.conclavePostUrl } : {}),
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
