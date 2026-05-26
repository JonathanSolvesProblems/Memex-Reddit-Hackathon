import { Hono } from "hono";
import type { TaskResponse } from "@devvit/web/server";
import { getConclave, listOpenConclaves } from "../core/redis";
import { closeExpired } from "../core/vote";
import { runConsistencySweep } from "../core/audit";
import { runWeeklyDigest } from "../core/digest";
import { loadSettings } from "../core/settings";

export const scheduler = new Hono();

/** Resolves Conclaves whose vote window has elapsed (replaces per-room timers). */
scheduler.post("/conclave-sweep", async (c) => {
  try {
    const settings = await loadSettings();
    const expiredIds = await listOpenConclaves(Date.now());
    for (const id of expiredIds) {
      const conclave = await getConclave(id);
      if (conclave && !conclave.closed) {
        await closeExpired(conclave, settings);
      }
    }
  } catch (e) {
    console.error("[Memex] conclave-sweep cron failed:", e);
  }
  return c.json<TaskResponse>({}, 200);
});

/** Periodic retrospective audit, only when the moderator has enabled it. */
scheduler.post("/consistency-sweep", async (c) => {
  try {
    const settings = await loadSettings();
    if (settings.autoSweepEnabled) {
      await runConsistencySweep(settings);
    }
  } catch (e) {
    console.error("[Memex] consistency-sweep cron failed:", e);
  }
  return c.json<TaskResponse>({}, 200);
});

/** Weekly shadow-mod calibration digest to the mod inbox. */
scheduler.post("/weekly-digest", async (c) => {
  try {
    await runWeeklyDigest();
  } catch (e) {
    console.error("[Memex] weekly-digest cron failed:", e);
  }
  return c.json<TaskResponse>({}, 200);
});
