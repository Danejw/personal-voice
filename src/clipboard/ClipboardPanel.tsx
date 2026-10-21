import { useEffect, useId, useState } from "react";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
import { HoverActionItem } from "@/components/HoverActionItem";
import type { ClipboardSnapshot, ClipboardStore } from "@/clipboard/ClipboardStore";
import { searchClipboardEntries, type ClipboardEntry } from "@/clipboard/clipboardEntry";
import { clipboardImageMime } from "@/clipboard/clipboardImageCodec";


export function ClipboardPanel({
  store,
  snapshot,
  devices,
  focusToken,
  onCopy,
  onClear,
}: {
  store: ClipboardStore;
  snapshot: ClipboardSnapshot;
  devices: readonly { id: string; name: string }[];
  focusToken: number;
  onCopy(entry: ClipboardEntry): Promise<void>;
  onClear(): Promise<void>;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const visible = searchClipboardEntries(snapshot.entries, query);

  useEffect(() => {
    if (!focusToken) return;
    document.getElementById(searchId)?.focus();
  }, [focusToken, searchId]);

  async function run(key: string, action: () => Promise<void>, success?: string) {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "Clipboard history couldn't be updated.");
    } finally {
      setBusy(null);
    }
  }

  function deviceName(entry: ClipboardEntry): string | null {
    if (!entry.sourceDeviceId) return null;
    return devices.find((device) => device.id === entry.sourceDeviceId)?.name ?? "Another device";
  }

  return (
    <div className="clipboard-history">
      <div className="clipboard-history-bar">
        <h3>Clipboard History</h3>
        <button
          type="button"
          className="secondary"
          disabled={snapshot.entries.length === 0}
          onClick={() => confirm.ask({
            title: "Clear clipboard history?",
            description: snapshot.status === "local"
              ? "Saved clipboard items will be permanently deleted from this device."
              : "Saved clipboard items will be permanently deleted from this account, including other devices.",
            confirmLabel: "Clear history",
            onConfirm: () => onClear(),
          })}
        >
          Clear Clipboard
        </button>
      </div>
      {problem && <p className="error" role="alert">{problem}</p>}
      {snapshot.error && <p className="error" role="alert">{snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label className="field stack" htmlFor={searchId}>
        <span>Search</span>
        <input
          id={searchId}
          value={query}
          placeholder="Search clipboard history"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visible.length === 0 ? (
        <p className="placeholder">No clipboard items yet. Copy something and it will show here.</p>
      ) : (
        <ul className="clipboard-list hide-scrollbar" tabIndex={0} aria-label="Clipboard history entries">
          {visible.map((entry) => (
            <HoverActionItem
              key={entry.id}
              actions={[
                {
                  kind: "copy",
                  disabled: busy !== null,
                  onClick: () => void run(`copy:${entry.id}`, () => onCopy(entry), "Copied."),
                },
                {
                  kind: entry.pinned ? "unpin" : "pin",
                  disabled: busy !== null,
                  onClick: () => void run(`pin:${entry.id}`, () => store.setPinned(entry.id, !entry.pinned)),
                },
                {
                  kind: "delete",
                  disabled: busy !== null,
                  onClick: () => confirm.ask({
                    title: "Delete clipboard item?",
                    description: "This item will be removed from clipboard history on every device signed into this account.",
                    confirmLabel: "Delete item",
                    onConfirm: () => run(`delete:${entry.id}`, () => store.remove(entry.id), "Deleted."),
                  }),
                },
              ]}
            >
              {entry.kind === "image"
                ? <ClipboardImage store={store} id={entry.id} />
                : <p className="handoff-text">{preview(entry.text)}</p>}
              <p className="note-meta">
                {labelFor(entry)}
                {entry.pinned ? " · Pinned" : ""}
                {entry.copyCount > 1 ? ` · Copied ${entry.copyCount} times` : ""}
                {entry.sourceApp ? ` · ${entry.sourceApp}` : ""}
                {deviceName(entry) ? ` · ${deviceName(entry)}` : ""}
                {" · "}
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              </p>
            </HoverActionItem>
          ))}
        </ul>
      )}
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </div>
  );
}

function ClipboardImage({ store, id }: { store: ClipboardStore; id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void store.readImage(id).then((bytes) => {
      if (!active || !bytes) return;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: clipboardImageMime(bytes) }));
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [store, id]);
  if (!url) return <p className="note-meta">Image saved</p>;
  return <img className="clipboard-thumb" src={url} alt="" />;
}

function preview(text: string | null): string {
  const value = text ?? "";
  return value.length > 280 ? `${value.slice(0, 279)}…` : value;
}

function labelFor(entry: ClipboardEntry): string {
  switch (entry.kind) {
    case "text": return "Text";
    case "url": return "Link";
    case "image": return "Image";
    default: {
      const unhandled: never = entry.kind;
      return unhandled;
    }
  }
}
