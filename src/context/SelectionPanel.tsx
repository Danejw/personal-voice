import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@/components/Tooltip";
import type { ContextItem } from "@/context/ContextItem";
import type { PlatformName } from "@/platform/PlatformAdapter";
import { TransformBox } from "@/transforms/TransformBox";
import type { TransformProfile } from "@/transforms/transformProfile";

interface SelectionPanelProps {
  platform: PlatformName;
  disabled: boolean;
  /** When true, Capture / Copy / Clear render in the shared page header. */
  active?: boolean;
  capture(): Promise<ContextItem>;
  onCaptured?(): void;
  /** Called with the capture, or null when the user clears it. Throw to reject an oversized selection. */
  onItem?(item: ContextItem | null): void;
  /** Assistant attachment. Clear on the Assistant page clears this preview too. */
  attached?: ContextItem | null;
  transformProfiles?: readonly TransformProfile[];
}

const HEADER_ACTIONS_ID = "page-header-actions";

/** Preview of text captured from another app, with optional reusable one-shot transforms. */
export function SelectionPanel({
  platform,
  disabled,
  active = false,
  capture,
  onCaptured,
  onItem,
  attached,
  transformProfiles = [],
}: SelectionPanelProps) {
  const [item, setItem] = useState<ContextItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transformOpen, setTransformOpen] = useState(false);

  useEffect(() => {
    if (attached === undefined) return;
    setItem(attached);
  }, [attached]);

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
      const next = await capture();
      onItem?.(next);
      setItem(next);
      setTransformOpen(false);
      try { onCaptured?.(); } catch { /* usage must not fail capture */ }
    }, "Selection captured.");
  }

  function onCopy() {
    if (!item) return;
    void run(() => navigator.clipboard.writeText(item.text), "Selection copied.");
  }

  function onClear() {
    setItem(null);
    setTransformOpen(false);
    setProblem(null);
    setNotice(null);
    onItem?.(null);
  }

  const actions = (
    <>
      <Tooltip content={hintFor(platform)}>
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy}
          onClick={onCapture}
        >
          {busy ? "Capturing…" : "Capture"}
        </button>
      </Tooltip>
      {transformProfiles.length > 0 && (
        <button
          type="button"
          className="secondary"
          disabled={!item || busy}
          onClick={() => setTransformOpen((open) => !open)}
        >
          Transform
        </button>
      )}
      <button type="button" className="secondary" disabled={!item || busy} onClick={onCopy}>Copy</button>
      <button type="button" className="secondary" disabled={!item || busy} onClick={onClear}>Clear</button>
    </>
  );

  const host = typeof document !== "undefined" ? document.getElementById(HEADER_ACTIONS_ID) : null;

  return (
    <>
      {active && host ? createPortal(actions, host) : null}
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p role="status">{notice}</p>}
      {item ? (
        <div className="selection-preview">
          <p className="handoff-text">{item.text}</p>
          <p className="note-meta">
            {item.sourceApp ? `${item.sourceApp} · ` : ""}
            <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString()}</time>
          </p>
          {transformOpen && (
            <TransformBox
              sourceText={item.text}
              profiles={transformProfiles}
              disabled={disabled}
              onClose={() => setTransformOpen(false)}
              actions={[{
                label: "Use transformed text",
                run: async (text) => {
                  const next = { ...item, text };
                  setItem(next);
                  onItem?.(next);
                  setTransformOpen(false);
                  setNotice("Transformed text is now the captured selection.");
                },
              }]}
            />
          )}
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
