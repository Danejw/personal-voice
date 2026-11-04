/** Pure, physical-pixel monitor geometry shared by Desktop and Android Companion Mode. */
import type { CompanionMonitor, CompanionAssistantPhase } from "@/device-link/protocol";
import type { AssistantSnapshot } from "@/assistant/state";

/** Never substitute a different PC when the user chose a specific target.
 * Without a preference, Companion starts only when exactly one PC is paired.
 */
export function selectedCompanionPC(
  pairedWindows: readonly { id: string }[], preferredId: string | null,
): string | null {
  if (preferredId) return pairedWindows.find(device => device.id === preferredId)?.id ?? null;
  return pairedWindows.length === 1 ? pairedWindows[0]?.id ?? null : null;
}

export interface PointerSample {
  x: number;
  y: number;
  monitors: CompanionMonitor[];
}

export function monitorFromIndex(monitors: readonly CompanionMonitor[], selected: number): CompanionMonitor | null {
  if (!monitors.length) return null;
  // The default phone placement is below the middle display, not the primary.
  const sorted = [...monitors].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2));
  return sorted[Math.min(sorted.length - 1, Math.max(0, selected))] ?? null;
}
export function defaultMonitorIndex(monitors: readonly CompanionMonitor[]): number {
  return Math.floor((monitors.length - 1) / 2);
}
const bound = (x: number) => Math.max(-1, Math.min(1, x));

/** Direction from a phone sitting below the target screen to a Windows cursor.
 * Ratios rather than absolute pixels prevent an unusually wide/high monitor
 * from dominating mixed-DPI, negative-origin display arrangements.
 */
export function companionGaze(
  pointer: { x: number; y: number },
  monitors: readonly CompanionMonitor[],
  monitorIndex: number,
): { x: number; y: number } {
  const screen = monitorFromIndex(monitors, monitorIndex);
  if (!screen || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return { x: 0, y: 0 };
  const phoneX = screen.x + screen.width / 2;
  const phoneY = screen.y + screen.height * 1.22;
  const dx = (pointer.x - phoneX) / Math.max(300, screen.width * 0.55);
  const dy = (pointer.y - phoneY) / Math.max(300, screen.height * 0.8);
  // atan keeps far-away cursor locations smooth instead of harshly clamped.
  return {
    x: bound(Math.atan(dx) / 1.18),
    y: bound(Math.atan(dy) / 1.18),
  };
}

export function isPointerSample(value: unknown): value is PointerSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<PointerSample>;
  return Number.isInteger(item.x) && Number.isInteger(item.y) &&
    Math.abs(item.x!) < 100_000 && Math.abs(item.y!) < 100_000 &&
    Array.isArray(item.monitors) && item.monitors.length >= 1 && item.monitors.length <= 8 &&
    item.monitors.every(m => Number.isInteger(m.x) && Number.isInteger(m.y)
      && Number.isInteger(m.width) && Number.isInteger(m.height)
      && m.width > 0 && m.height > 0 && m.width < 30_000 && m.height < 30_000);
}

export function assistantPhase(snapshot: AssistantSnapshot): CompanionAssistantPhase {
  if (snapshot.status === "RESPONDING") return snapshot.liveText.trim() ? "speaking" : "thinking";
  if (snapshot.status === "CONNECTING" || snapshot.toolActivity?.status === "running") return "thinking";
  if (snapshot.status === "READY") return "listening";
  return "idle";
}
