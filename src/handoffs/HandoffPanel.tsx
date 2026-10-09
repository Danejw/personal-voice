import { useState } from "react";
import type { FormEvent } from "react";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
import { acceptContinuation, classifyHandoffText, handoffDisplayText, type AssistantContinuation } from "@/assistant/continuation";
import { HoverActionItem } from "@/components/HoverActionItem";
import { Tooltip } from "@/components/Tooltip";
import { DeviceTargetField } from "@/handoffs/DeviceTargetField";
import type { HandoffSnapshot, HandoffStatus, HandoffStore } from "@/handoffs/HandoffStore";
import type { Handoff } from "@/handoffs/handoff";
import { TransformBox } from "@/transforms/TransformBox";
import type { TransformProfile } from "@/transforms/transformProfile";

interface HandoffPanelProps {
  store: HandoffStore;
  snapshot: HandoffSnapshot;
  insertIntoActiveField(text: string): Promise<void>;
  attachedHandoffId?: string | null;
  onAttachHandoff?: (handoff: Handoff, sourceLabel: string) => string | null;
  onDetachHandoff?: () => void;
  onOpenContinuation?: (payload: AssistantContinuation) => string | null;
  transformProfiles?: readonly TransformProfile[];
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
export function HandoffPanel({
  store,
  snapshot,
  insertIntoActiveField,
  attachedHandoffId = null,
  onAttachHandoff,
  onDetachHandoff,
  onOpenContinuation,
  transformProfiles = [],
}: HandoffPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const [draftTransformOpen, setDraftTransformOpen] = useState(false);
  const [transformingId, setTransformingId] = useState<string | null>(null);
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
      setDraftTransformOpen(false);
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
    confirm.ask({
      title: "Dismiss handoff?",
      description: "This received handoff will be removed from the inbox. Make sure you have copied or inserted anything you want to keep.",
      confirmLabel: "Dismiss handoff",
      onConfirm: () => run(`dismiss:${handoff.id}`, () => store.consume(handoff.id)),
    });
  }

  function attach(handoff: Handoff) {
    setProblem(onAttachHandoff?.(handoff, sourceLabel(handoff)) ?? null);
  }

  function openContinuation(handoff: Handoff) {
    const classified = classifyHandoffText(handoff.text);
    if (classified.kind !== "continuation") {
      setProblem(classified.kind === "malformed" ? classified.message : "That handoff is plain text.");
      return;
    }
    const owned = acceptContinuation(classified.payload, handoff);
    if (!owned.ok) {
      setProblem(owned.message);
      return;
    }
    const message = onOpenContinuation?.(classified.payload);
    if (message) {
      setProblem(message);
      return;
    }
    void run(`continue:${handoff.id}`, () => store.consume(handoff.id));
  }

  function sourceLabel(handoff: Handoff): string {
    return snapshot.devices.find((device) => device.id === handoff.sourceDeviceId)?.name ?? "Another device";
  }

  return (
    <>
      <DeviceTargetField label="Target" store={store} snapshot={snapshot} disabled={busy !== null} layout="stack" />
      <form className="handoff-form" onSubmit={onSend}>
        <Tooltip content="Sends without dictating.">
          <textarea
            aria-label="Text to send" placeholder="Text to send"
            maxLength={100000} rows={2}
            value={draft} disabled={!connected || busy !== null} onChange={(event) => setDraft(event.target.value)}
          />
        </Tooltip>
        {transformProfiles.length > 0 && (
          <button
            type="button"
            className="secondary"
            disabled={!connected || busy !== null || !draft.trim()}
            onClick={() => setDraftTransformOpen((open) => !open)}
          >
            Transform
          </button>
        )}
        <button type="submit" className="secondary" disabled={!connected || busy !== null || !draft.trim()}>
          Send
        </button>
      </form>
      {draftTransformOpen && draft.trim() && (
        <TransformBox
          sourceText={draft}
          profiles={transformProfiles}
          disabled={!connected}
          onClose={() => setDraftTransformOpen(false)}
          actions={[{
            label: "Use in draft",
            run: async (text) => {
              setDraft(text);
              setDraftTransformOpen(false);
            },
          }]}
        />
      )}
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
              const attached = attachedHandoffId === handoff.id;
              const classified = classifyHandoffText(handoff.text);
              const plain = classified.kind === "text";
              return (
                <HoverActionItem
                  key={handoff.id}
                  busy={pending}
                  actions={[
                    ...(plain && onAttachHandoff && onDetachHandoff ? [{
                      kind: "attach" as const,
                      label: attached ? "Remove from Assistant" : "Attach to Assistant",
                      onClick: () => { if (attached) onDetachHandoff(); else attach(handoff); },
                    }] : []),
                    ...(plain ? [
                      ...(transformProfiles.length ? [{
                        kind: "transform" as const,
                        onClick: () => setTransformingId((current) => current === handoff.id ? null : handoff.id),
                      }] : []),
                      { kind: "copy" as const, onClick: () => copy(handoff) },
                      { kind: "insert" as const, onClick: () => insert(handoff) },
                    ] : []),
                    { kind: "dismiss" as const, disabled: !connected, onClick: () => dismiss(handoff) },
                  ]}
                >
                  <p className="handoff-text">{handoffDisplayText(handoff.text)}</p>
                  <p className="note-meta">
                    {classified.kind === "continuation" ? "Assistant continuation · " : ""}
                    {sourceLabel(handoff)} · <time dateTime={handoff.createdAt}>{new Date(handoff.createdAt).toLocaleString()}</time>
                  </p>
                  {plain && transformingId === handoff.id && (
                    <TransformBox
                      sourceText={handoff.text}
                      profiles={transformProfiles}
                      onClose={() => setTransformingId(null)}
                      actions={[{
                        label: "Insert",
                        run: async (text) => {
                          await insertIntoActiveField(text);
                          setTransformingId(null);
                          setNotice("Transformed text inserted.");
                        },
                      }]}
                    />
                  )}
                  {classified.kind === "continuation" && onOpenContinuation && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={!connected || pending}
                      onClick={() => openContinuation(handoff)}
                    >
                      Continue
                    </button>
                  )}
                </HoverActionItem>
              );
            })}
          </ul>
        ) : (
          <p className="placeholder">No received text.</p>
        )}
      </div>
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </>
  );
}
