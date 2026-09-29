/** The application that received a paste. The id is a file or package name, never a window title. */
export interface TargetApp {
  id: string;
  label: string;
}

/** Accepts the payload from a successful insert. A missing or blank id means the paste was not named. */
export function parseTargetApp(value: unknown): TargetApp | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { id?: unknown; label?: unknown };
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : record.id.trim();
  return { id: record.id.trim(), label };
}
