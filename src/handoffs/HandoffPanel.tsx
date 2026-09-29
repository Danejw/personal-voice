import { useState } from "react";
import type { FormEvent } from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import { Tooltip } from "@/components/Tooltip";
import { DeviceTargetField } from "@/handoffs/DeviceTargetField";
import type { HandoffSnapshot, HandoffStatus, HandoffStore } from "@/handoffs/HandoffStore";
import type { Handoff } from "@/handoffs/handoff";

interface HandoffPanelProps {
  store: HandoffStore;
  snapshot: HandoffSnapshot;
  insertIntoActiveField(text: string): Promise<void>;
}

function statusLabel(status: HandoffStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "synced": return "Ready";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled handoff status: ${String(unhandled)}`);
    }
  }
}

/** Sync status + Refresh for the shared page header. */
export function HandoffToolbar({
  store,
  snapshot,
  busy = false,
}: {
  store: HandoffStore;
  snapshot: HandoffSnapshot;
  busy?: boolean;
}) {
  return (
    <div className="page-header-actions">
      <p role="status">{statusLabel(snapshot.status)}</p>
      {snapshot.status !== "signed-out" && (
        <button
          type="button"
          className="secondary"
          disabled={snapshot.status === "loading" || busy}
          onClick={() => void store.reload()}
        >
          Refresh
        </button>
      )}
    </div>
  );
}

/** Shared clipboard composition plus the receiving inbox; Supabase remains the only transport. */
export function HandoffPanel({ store, snapshot, insertIntoActiveField }: HandoffPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connected = snapshot.status === "synced";

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("send", async () => {
      await store.send(draft, "clipboard");
      setDraft("");
      setNotice("Sent.");
    });
  }

  function copy(handoff: Handoff) {
    void run(`copy:${handoff.id}`, async () => {
      await navigator.clipboard.writeText(handoff.text);
      setNotice("Text copied.");
    });
  }

  function insert(handoff: Handoff) {
    void run(`insert:${handoff.id}`, async () => {
      await insertIntoActiveField(handoff.text);
      setNotice("Inserted. Dismiss the handoff when you are done with it.");
    });
  }

  function dismiss(handoff: Handoff) {
    void run(`dismiss:${handoff.id}`, () => store.consume(handoff.id));
  }

  function sourceLabel(handoff: Handoff): string {
    return snapshot.devices.find((device) => device.id === handoff.sourceDeviceId)?.name ?? "Another device";
  }

  return (
    <>
      <DeviceTargetField label="Target" store={store} snapshot={snapshot} disabled={busy !== null} />
      <form className="handoff-form" onSubmit={onSend}>
        <Tooltip content="Sends without dictating.">
          <textarea
            aria-label="Text to send" placeholder="Text to send"
            maxLength={100000} rows={2}
            value={draft} disabled={!connected || busy !== null} onChange={(event) => setDraft(event.target.value)}
          />
        </Tooltip>
        <button type="submit" className="secondary" disabled={!connected || busy !== null || !draft.trim()}>
          Send
        </button>
      </form>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="page-grow">
        <div className="handoff-list-heading">
          <h3>Received</h3>
          <span>{snapshot.received.length}</span>
        </div>
        {snapshot.received.length ? (
          <ul className="handoffs hide-scrollbar">
            {snapshot.received.map((handoff) => {
              const pending = busy?.endsWith(handoff.id) ?? false;
              return (
                <HoverActionItem
                  key={handoff.id}
                  busy={pending}
                  actions={[
                    { kind: "copy", onClick: () => copy(handoff) },
                    { kind: "insert", onClick: () => insert(handoff) },
                    { kind: "dismiss", disabled: !connected, onClick: () => dismiss(handoff) },
                  ]}
                >
                  <p className="handoff-text">{handoff.text}</p>
                  <p className="note-meta">
                    {sourceLabel(handoff)} · <time dateTime={handoff.createdAt}>{new Date(handoff.createdAt).toLocaleString()}</time>
                  </p>
                </HoverActionItem>
              );
            })}
          </ul>
        ) : (
          <p className="placeholder">No received text.</p>
        )}
      </div>
    </>
  );
}
