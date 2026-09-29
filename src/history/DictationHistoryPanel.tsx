import { useState } from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import type {
  DictationHistoryEntry,
  DictationHistorySnapshot,
  DictationHistoryStore,
} from "@/history/DictationHistoryStore";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

interface DictationHistoryPanelProps {
  store: DictationHistoryStore;
  snapshot: DictationHistorySnapshot;
  insertIntoActiveField(text: string): Promise<void>;
  onInserted?(): void;
}

function destinationLabel(destination: TranscriptDestinationId): string {
  switch (destination) {
    case "active-field": return "Active field";
    case "voice-note": return "Voice note";
    case "send-to-device": return "Send to device";
    default: {
      const unhandled: never = destination;
      throw new Error(`Unhandled transcript destination: ${String(unhandled)}`);
    }
  }
}

/** Local recovery list for finalized dictations, whether delivery succeeded or failed. */
export function DictationHistoryPanel({
  store,
  snapshot,
  insertIntoActiveField,
  onInserted,
}: DictationHistoryPanelProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(index: number, action: () => Promise<void>, success: string) {
    setBusy(index);
    setProblem(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  function copy(entry: DictationHistoryEntry, index: number) {
    void run(index, () => navigator.clipboard.writeText(entry.text), "Transcript copied.");
  }

  function insert(entry: DictationHistoryEntry, index: number) {
    void run(index, async () => {
      await insertIntoActiveField(entry.text);
      onInserted?.();
    }, "Transcript inserted.");
  }

  function clear() {
    setProblem(null);
    setNotice(null);
    store.clear();
  }

  return (
    <>
      <div className="card-head">
        <h2 id="history-heading" title="Final text, stored on this device">Recent dictation</h2>
        <button
          type="button" className="secondary"
          disabled={!snapshot.entries.length || busy !== null} onClick={clear}
        >
          Clear
        </button>
      </div>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {snapshot.entries.length ? (
        <ul className="handoffs history hide-scrollbar">
          {snapshot.entries.map((entry, index) => (
            <HoverActionItem
              key={`${entry.timestamp}:${index}`}
              busy={busy === index}
              actions={[
                { kind: "copy", onClick: () => copy(entry, index) },
                { kind: "insert", onClick: () => insert(entry, index) },
              ]}
            >
              <p className="handoff-text">{entry.text}</p>
              <p className="note-meta">
                {destinationLabel(entry.destination)} · {entry.outcome === "success" ? "Delivered" : "Failed"} ·{" "}
                <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
              </p>
            </HoverActionItem>
          ))}
        </ul>
      ) : (
        <p className="placeholder">No recent dictations</p>
      )}
    </>
  );
}
