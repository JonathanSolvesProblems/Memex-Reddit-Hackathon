import { Hono } from "hono";
import type { SettingsValidationResponse } from "@devvit/web/shared";
import { detectProvider } from "../core/providers";

export const settingsRoutes = new Hono();

/**
 * Validates the embedding API key as it's entered. A blank value is allowed (the
 * app simply stays on the local engine, no error), and a non-empty value must be
 * a key shape Memex recognizes, so a mistyped key is caught at save time rather
 * than failing silently later.
 */
settingsRoutes.post("/validate-key", async (c) => {
  const body = await c.req
    .json<{ value?: string }>()
    .catch(() => ({ value: "" }));
  const value = typeof body.value === "string" ? body.value.trim() : "";

  if (!value) {
    return c.json<SettingsValidationResponse>({ success: true });
  }
  if (!detectProvider(value)) {
    return c.json<SettingsValidationResponse>({
      success: false,
      error:
        "Unrecognized key. Use an OpenAI key (sk-...) or Google Gemini key (AIza...), or leave this blank to run on the local engine.",
    });
  }
  return c.json<SettingsValidationResponse>({ success: true });
});
