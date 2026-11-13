/** Pure visual descriptor. Never contains credentials, executable scripts, or agent sessions. */
export type WorldPalette = "cyan" | "violet" | "amber";
export interface WorldConfig {
  kind: "terrain";
  palette: WorldPalette;
}
export const DEFAULT_WORLD: WorldConfig = { kind: "terrain", palette: "cyan" };
const palettes: Record<WorldPalette, { background: string; lines: string; glow: [number, number, number] }> = {
  cyan: { background: "#02060c", lines: "#168ebd", glow: [0.15, 0.78, 1] },
  violet: { background: "#080414", lines: "#8d5ce6", glow: [0.63, 0.37, 1] },
  amber: { background: "#110a04", lines: "#d48c2b", glow: [1, 0.59, 0.17] },
};
export function parseWorldConfig(input: unknown): WorldConfig {
  if (!input || typeof input !== "object") return DEFAULT_WORLD;
  const value = input as Record<string, unknown>;
  if (value.kind !== "terrain" || !Object.prototype.hasOwnProperty.call(palettes, value.palette)) return DEFAULT_WORLD;
  return { kind: "terrain", palette: value.palette as WorldPalette };
}
export function worldColors(config: WorldConfig) { return palettes[config.palette]; }
