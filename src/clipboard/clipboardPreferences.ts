import type { ClipboardPreferenceAccess } from "@/clipboard/ClipboardStore";
import { DEFAULT_CLIPBOARD_PREFERENCES, type ClipboardPreferences } from "@/clipboard/clipboardEntry";

function fixed(): ClipboardPreferences {
  return { ...DEFAULT_CLIPBOARD_PREFERENCES };
}

/** Clipboard history has one fixed behavior. Capture, sync, and images are always on. */
export function deviceClipboardPreferences(): ClipboardPreferenceAccess {
  return {
    load: fixed,
    save: fixed,
  };
}
