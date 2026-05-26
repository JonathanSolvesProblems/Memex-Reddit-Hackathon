import { afterEach, describe, expect, it } from "vitest";
import { __resetStore, __setSettings } from "../../../test/stubs/devvit-server";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";
import { getSemanticConfig } from "./semantic";

afterEach(() => __resetStore());

describe("loadSettings", () => {
  it("returns defaults when nothing is configured", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("merges configured overrides and parses keyword lists", async () => {
    __setSettings({
      quorumSize: 5,
      autoRouteEnabled: true,
      autoRouteKeywords: "Crypto, NFT\nairdrop",
      banRequiresHumanClick: false,
    });
    const s = await loadSettings();
    expect(s.quorumSize).toBe(5);
    expect(s.autoRouteEnabled).toBe(true);
    expect(s.autoRouteKeywords).toEqual(["crypto", "nft", "airdrop"]);
    expect(s.banRequiresHumanClick).toBe(false);
    // untouched fields keep their defaults
    expect(s.voteWindowHours).toBe(DEFAULT_SETTINGS.voteWindowHours);
  });

  it("ignores wrong-typed values and falls back to defaults", async () => {
    __setSettings({ quorumSize: "lots", autoRouteEnabled: "yes" });
    const s = await loadSettings();
    expect(s.quorumSize).toBe(DEFAULT_SETTINGS.quorumSize);
    expect(s.autoRouteEnabled).toBe(DEFAULT_SETTINGS.autoRouteEnabled);
  });
});

describe("getSemanticConfig", () => {
  it("is disabled by default (no key, toggle off)", async () => {
    const c = await getSemanticConfig();
    expect(c.enabled).toBe(false);
  });

  it("stays disabled if the toggle is on but no key is set", async () => {
    __setSettings({ semanticEnabled: true });
    expect((await getSemanticConfig()).enabled).toBe(false);
  });

  it("enables only with both a key and the toggle, and scales the weight", async () => {
    __setSettings({
      semanticEnabled: true,
      openaiApiKey: "sk-test",
      semanticWeight: 80,
    });
    const c = await getSemanticConfig();
    expect(c.enabled).toBe(true);
    expect(c.weight).toBeCloseTo(0.8, 5);
  });
});
