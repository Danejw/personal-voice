import { useState } from "react";
import type { FormEvent } from "react";
import type { PersonalSyncStore, SyncSnapshot } from "@/sync/PersonalSyncStore";
import { readOnlyReason } from "@/sync/SyncStatus";
import { MAX_ENABLED_TERMS, MAX_TERM_LENGTH, enabledCount } from "@/sync/personalData";

interface DictionaryPanelProps {
  store: PersonalSyncStore;
  sync: SyncSnapshot;
}

/** Names and jargon Gemini should recognize. Only enabled terms are sent, from the next utterance. */
export function DictionaryPanel({ store, sync }: DictionaryPanelProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
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
          {terms.map((entry) => (
            <li key={entry.id} className={entry.enabled ? undefined : "term-off"}>
              <label>
                <input
                  type="checkbox" checked={entry.enabled} disabled={!editable}
                  onChange={(event) => setProblem(store.setTermEnabled(entry.id, event.target.checked))}
                />
                <span>{entry.term}</span>
              </label>
              <button
                type="button" className="term-delete" aria-label={`Delete ${entry.term}`} disabled={!editable}
                onClick={() => setProblem(store.removeTerm(entry.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="placeholder">No terms yet.</p>
      )}
    </>
  );
}
