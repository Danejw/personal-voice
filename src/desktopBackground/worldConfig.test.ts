import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD, parseWorldConfig, worldColors } from "./worldConfig";
describe("safe spatial world descriptors", () => {
  it("falls back for unsupported kinds and palettes", () => {
    expect(parseWorldConfig({ kind: "script", palette: "cyan" })).toEqual(DEFAULT_WORLD);
    expect(parseWorldConfig({ kind: "terrain", palette: "other" })).toEqual(DEFAULT_WORLD);
    expect(parseWorldConfig(null)).toEqual(DEFAULT_WORLD);
  });
  it("keeps approved render presets independent", () => {
    expect(worldColors(parseWorldConfig({ kind: "terrain", palette: "violet" })).background)
      .not.toBe(worldColors(DEFAULT_WORLD).background);
  });
});
