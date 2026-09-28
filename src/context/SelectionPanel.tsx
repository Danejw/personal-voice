import { useState } from "react";
import type { ContextItem } from "@/context/ContextItem";
import type { PlatformName } from "@/platform/PlatformAdapter";

interface SelectionPanelProps {
  platform: PlatformName;
  disabled: boolean;
  capture(): Promise<ContextItem>;
  onCaptured?(): void;
}

/** Preview of text captured from another app. No transformation is applied. */
export function SelectionPanel({ platform, disabled, capture, onCaptured }: SelectionPanelProps) {
  const [item, setItem] = useState<ContextItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function onCapture() {
    void run(async () => {
      setItem(await capture());
      try { onCaptured?.(); } catch { /* usage must not fail capture */ }
    }, "Selection captured.");
  }

  function onCopy() {
    if (!item) return;
    void run(() => navigator.clipboard.writeText(item.text), "Selection copied.");
  }

  function onClear() {
    setItem(null);
    setProblem(null);
    setNotice(null);
  }

  return (
    <>
      <div className="card-head">
        <h2 id="selection-heading">Capture selection</h2>
        <div className="actions">
          <button
            type="button" className="secondary" title={hintFor(platform)}
            disabled={disabled || busy} onClick={onCapture}
          >
            {busy ? "Capturing…" : "Capture"}
          </button>
          <button type="button" className="secondary" disabled={!item || busy} onClick={onCopy}>Copy</button>
          <button type="button" className="secondary" disabled={!item || busy} onClick={onClear}>Clear</button>
        </div>
      </div>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p role="status">{notice}</p>}
      {item ? (
        <div className="selection-preview">
          <p className="handoff-text">{item.text}</p>
          <p className="note-meta">
            {item.sourceApp ? `${item.sourceApp} · ` : ""}
            <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString()}</time>
          </p>
        </div>
      ) : (
        <p className="placeholder">No selection captured</p>
      )}
    </>
  );
}

function hintFor(platform: PlatformName): string {
  switch (platform) {
    case "windows":
      return "Highlight text in another app, then capture. Personal Voice copies it briefly and restores your clipboard.";
    case "android":
      return "Select text in a focused text field in another app, then capture. Pages and read-only screens are not read.";
    default: {
      const unhandled: never = platform;
      throw new Error(`Unhandled platform: ${String(unhandled)}`);
    }
  }
}
