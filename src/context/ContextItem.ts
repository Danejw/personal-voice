/** Highlighted text captured from another app at the user's request. */
export interface ContextItem {
  type: "selection";
  text: string;
  sourceApp?: string;
  capturedAt: string;
}

/** Native capture result before the shared `capturedAt` timestamp is applied. */
export interface CapturedSelection {
  text: string;
  sourceApp?: string;
}

/**
 * Turns a native capture payload into a `ContextItem`. Empty text is a capture
 * failure, not an empty preview.
 */
export function contextItemFromCapture(
  payload: unknown,
  now: () => string = () => new Date().toISOString(),
): ContextItem {
  const captured = parseCapturedSelection(payload);
  return {
    type: "selection",
    text: captured.text,
    ...(captured.sourceApp ? { sourceApp: captured.sourceApp } : {}),
    capturedAt: now(),
  };
}

/** Validates the IPC/plugin payload from either platform adapter. */
export function parseCapturedSelection(payload: unknown): CapturedSelection {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("The selected text could not be read.");
  }
  const record = payload as { text?: unknown; sourceApp?: unknown };
  if (typeof record.text !== "string" || record.text.length === 0) {
    throw new Error("No text is selected in the other app.");
  }
  const sourceApp = typeof record.sourceApp === "string" && record.sourceApp ? record.sourceApp : undefined;
  return sourceApp ? { text: record.text, sourceApp } : { text: record.text };
}
