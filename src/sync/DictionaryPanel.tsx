import { useState } from "react";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
import type { FormEvent } from "react";
import type { PersonalSyncStore, SyncSnapshot, SyncStatus as Status } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";
import { MAX_ENABLED_TERMS, MAX_TERM_LENGTH, enabledCount, newestTermsFirst } from "@/sync/personalData";

interface DictionaryPanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
  /** Lowercased term → appearances and the last day it appeared. */
  termUsage?: Readonly<Record<string, { uses: number; lastDay: string | null }>>;
}

function syncLabel(status: Status): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Syncing…";
    case "synced": return "Synced";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled sync status: ${String(unhandled)}`);
    }
  }
}

function termLabel(stat: { uses: number; lastDay: string | null } | undefined): string {
  if (!stat || stat.uses === 0) return "Never used";
  return `${stat.uses} uses`;
}

/** Sync status + Refresh for the shared page header. */
export function DictionaryToolbar({ store, sync }: Pick<DictionaryPanelProps, "store" | "sync">) {
  return (
    <div className="page-header-actions">
      <p role="status">{syncLabel(sync.status)}</p>
      {sync.status !== "signed-out" && (
        <button
          type="button"
          className="secondary"
          disabled={sync.status === "loading"}
          onClick={() => void store.reload()}
        >
          Refresh
        </button>
      )}
    </div>
  );
}

/** Names and jargon Gemini should recognize. Only enabled terms are sent, from the next utterance. */
export function DictionaryPanel({ store, sync, termUsage = {} }: DictionaryPanelProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const { terms } = sync.data;
  const readOnly = readOnlyReason(sync.status);
  const editable = !readOnly;

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const refused = store.addTerm(draft);
    setProblem(refused);
    if (!refused) setDraft("");
  }

  return (
    <>
      <p className="hint">
        {enabledCount(terms)}/{MAX_ENABLED_TERMS} active{readOnly ? ` · ${readOnly}` : ""}
      </p>
      {sync.error && <p className="error" role="alert">{sync.error}</p>}
      <form className="term-form" onSubmit={onAdd}>
        <input
          aria-label="New term" placeholder="Add a word or phrase" maxLength={MAX_TERM_LENGTH}
          value={draft} disabled={!editable} onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={!editable || !draft.trim()}>Add</button>
      </form>
      {problem && <p className="error" role="alert">{problem}</p>}
      {terms.length > 0 ? (
        <ul className="terms hide-scrollbar">
          {newestTermsFirst(terms).map((entry) => (
            <li key={entry.id} className={entry.enabled ? undefined : "term-off"}>
              <label>
                <input
                  type="checkbox" checked={entry.enabled} disabled={!editable}
                  onChange={(event) => setProblem(store.setTermEnabled(entry.id, event.target.checked))}
                />
                <span>{entry.term}</span>
                <span className="hint">{termLabel(termUsage[entry.term.toLocaleLowerCase()])}</span>
              </label>
              <button
                type="button" className="term-delete" aria-label={`Delete ${entry.term}`} disabled={!editable}
                onClick={() => confirm.ask({
                  title: "Delete dictionary term?",
                  description: `“${entry.term}” will be removed from your dictionary and will no longer help dictation recognition.`,
                  confirmLabel: "Delete term",
                  onConfirm: () => { const failure = store.removeTerm(entry.id); setProblem(failure); if (failure) throw new Error(failure); },
                })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="placeholder">No terms yet.</p>
      )}
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </>
  );
}
