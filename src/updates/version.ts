/** A release version as `[major, minor, patch]`. */
export type Version = readonly [number, number, number];

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Accepts `1.2.3` or a tag like `v1.2.3`. Pre-release and build suffixes aren't published, so they're rejected. */
export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `false` when either side isn't a plain release version, so a malformed tag never offers an update. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== installed[i]) return (next[i] ?? 0) > (installed[i] ?? 0);
  }
  return false;
}
