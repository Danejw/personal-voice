/**
 * One explicit screenshot for Assistant. The JPEG stays in memory.
 * Nothing here writes a file or starts a repeating capture.
 *
 * Gemini 3.8 Live takes a still image as one video frame
 * (`realtimeInput.video`, `image/jpeg`), checked against
 * https://ai.google.dev/gemini-api/docs/live-api/capabilities on 2026-09-28.
 */

export const SNAPSHOT_MAX_EDGE = 1_280;
export const SNAPSHOT_MAX_DIMENSION = 8_000;
/** Encoded JPEG, not base64 length. */
export const SNAPSHOT_MAX_BYTES = 1_000_000;

export type SnapshotKind = "window" | "screen";

export interface ScreenSnapshot {
  source: SnapshotKind;
  sourceApp?: string;
  capturedAt: string;
  /** Raw JPEG bytes as base64, without a data-URL prefix. */
  jpeg: string;
  width: number;
  height: number;
}

export interface RgbaFrame {
  kind: "rgba";
  source: SnapshotKind;
  sourceApp?: string;
  width: number;
  height: number;
  /** Tightly packed RGBA, base64. */
  rgba: string;
}

export interface JpegFrame {
  kind: "jpeg";
  source: SnapshotKind;
  sourceApp?: string;
  jpeg: string;
  width?: number;
  height?: number;
}

export type NativeSnapshot = RgbaFrame | JpegFrame;

/** Scales so the long edge fits. Empty or huge frames are refused. */
export function fitSnapshotEdge(width: number, height: number, maxEdge = SNAPSHOT_MAX_EDGE): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The screenshot was empty.");
  }
  if (width > SNAPSHOT_MAX_DIMENSION || height > SNAPSHOT_MAX_DIMENSION) {
    throw new Error("That screenshot is too large.");
  }
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Validates a platform payload. Does not encode. */
export function parseNativeSnapshot(payload: unknown): NativeSnapshot {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The screenshot could not be read.");
  }
  const record = payload as { source?: unknown; sourceApp?: unknown; width?: unknown; height?: unknown; rgba?: unknown; jpeg?: unknown };
  const source = record.source === "window" || record.source === "screen" ? record.source : null;
  if (!source) throw new Error("The screenshot could not be read.");
  const sourceApp = typeof record.sourceApp === "string" && record.sourceApp ? record.sourceApp : undefined;
  if (typeof record.jpeg === "string" && record.jpeg) {
    assertJpeg(record.jpeg);
    return { kind: "jpeg", source, ...(sourceApp ? { sourceApp } : {}), jpeg: record.jpeg };
  }
  if (typeof record.rgba !== "string" || !record.rgba) throw new Error("The screenshot could not be read.");
  if (typeof record.width !== "number" || typeof record.height !== "number") throw new Error("The screenshot was empty.");
  fitSnapshotEdge(record.width, record.height);
  const bytes = Math.ceil(record.rgba.length * 3 / 4);
  if (bytes < record.width * record.height * 4) throw new Error("The screenshot could not be read.");
  return {
    kind: "rgba",
    source,
    ...(sourceApp ? { sourceApp } : {}),
    width: record.width,
    height: record.height,
    rgba: record.rgba,
  };
}

export function assertJpeg(jpeg: string): void {
  let bytes: Uint8Array;
  try {
    const binary = atob(jpeg);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    throw new Error("The screenshot could not be read.");
  }
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("The screenshot could not be read.");
  }
  if (bytes.length > SNAPSHOT_MAX_BYTES) throw new Error("That screenshot is too large to send.");
}

/** Turns a native frame into the in-memory snapshot Assistant keeps. */
export function snapshotFromNative(
  payload: unknown,
  encode: (rgbaBase64: string, width: number, height: number) => string,
  now: () => string = () => new Date().toISOString(),
): ScreenSnapshot {
  const native = parseNativeSnapshot(payload);
  const capturedAt = now();
  if (native.kind === "jpeg") {
    return {
      source: native.source,
      ...(native.sourceApp ? { sourceApp: native.sourceApp } : {}),
      capturedAt,
      jpeg: native.jpeg,
      width: native.width ?? 0,
      height: native.height ?? 0,
    };
  }
  const target = fitSnapshotEdge(native.width, native.height);
  const jpeg = encode(native.rgba, native.width, native.height);
  assertJpeg(jpeg);
  return {
    source: native.source,
    ...(native.sourceApp ? { sourceApp: native.sourceApp } : {}),
    capturedAt,
    jpeg,
    width: target.width,
    height: target.height,
  };
}

/** Context note. The image itself is a separate Live video frame. */
export function snapshotContextText(snapshot: Pick<ScreenSnapshot, "source" | "sourceApp">): string {
  const kind = snapshot.source === "window" ? "the active window" : "the screen";
  const app = snapshot.sourceApp ? ` Source app: ${snapshot.sourceApp}.` : "";
  return `A single screenshot of ${kind} was attached.${app} It stays the active image for later questions in this session until capture_screen runs again. It is one still image, not a live view. Do not assume the screen still looks like this. If the user asks you to look again, call capture_screen. Do not describe a screen that was not captured. Do not include it in a web search unless the user asks you to look up something public that is visible in it.`;
}

export function snapshotDetachedText(): string {
  return "The attached screenshot was removed. It is not active context. Do not describe that image unless the user captures it again.";
}
