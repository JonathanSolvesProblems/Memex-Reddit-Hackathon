import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const stub = (p: string) =>
  fileURLToPath(new URL(`./test/stubs/${p}`, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Run server modules against in-memory stubs (no live Devvit runtime).
      "@devvit/web/server": stub("devvit-server.ts"),
      "@devvit/web/shared": stub("devvit-shared.ts"),
    },
  },
});
