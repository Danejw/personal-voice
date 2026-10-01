import { useState } from "react";
import { SelectField } from "@/components/SelectField";
import { Toggle } from "@/components/Toggle";
import type { AssistantMemory, MemoryKind } from "@/assistant/memory";
import type { AssistantMemoryStore, MemorySnapshot } from "@/assistant/AssistantMemoryStore";

interface MemoryPanelProps {
  store: AssistantMemoryStore;
  snapshot: MemorySnapshot;
  signedIn: boolean;
  learning: boolean;
  onLearningChange(enabled: boolean): void;
}

/** What this account asked Assistant to remember. Edit and Forget stay on the account. */
export function MemoryPanel({ store, snapshot, signedIn, learning, onLearningChange }: MemoryPanelProps) {
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [key, setKey] = useState("answer_length");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const active = snapshot.memories.filter((row) => row.status === "active");
  const candidates = snapshot.memories.filter((row) => row.status === "candidate");
  const forgotten = forgottenKeys(snapshot.memories);

  async function remember(): Promise<void> {
    setNotice(null);
    try {
      setNotice(await store.remember(kind, key, value));
      setValue("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't remember that.");
    }
  }

  async function save(row: AssistantMemory): Promise<void> {
    setNotice(null);
    try {
      setNotice(await store.change(row.key, draft));
      setEditing(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't change that.");
    }
  }

  async function keep(row: AssistantMemory): Promise<void> {
    setNotice(null);
    try {
      setNotice(await store.keepCandidate(row.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't keep that.");
    }
  }

  async function remove(row: AssistantMemory): Promise<void> {
    setNotice(null);
    try {
      setNotice(await store.dismissCandidate(row.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't remove that.");
    }
  }

  async function forget(row: AssistantMemory): Promise<void> {
    setNotice(null);
    try {
      setNotice(await store.forget(row.key));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't forget that.");
    }
  }

  return (
    <details className="fold">
      <summary>Remembered{active.length ? ` · ${active.length}` : ""}</summary>
      <p>These follow the account onto every device. A new Assistant session hears the active ones. Forgetting one does not delete the conversation it came from.</p>
      {signedIn && (
        <Toggle
          label="Learn from Assistant"
          description="Only saved Assistant messages after this is turned on. This does not read voice notes or dictations."
          checked={learning}
          disabled={snapshot.saving}
          onChange={onLearningChange}
        />
      )}
      {snapshot.offline && <p>Showing the saved copy on this device. Assistant will not use it until it reconnects.</p>}
      {signedIn && (
        <form className="field stack" onSubmit={(event) => { event.preventDefault(); void remember(); }}>
          <span>Remember</span>
          <SelectField
            label="Kind"
            value={kind}
            options={[{ value: "preference", label: "Preference" }, { value: "fact", label: "Fact" }]}
            disabled={snapshot.saving}
            layout="stack"
            onChange={(next) => setKind(next === "fact" ? "fact" : "preference")}
          />
          <input value={key} onChange={(event) => setKey(event.target.value)} aria-label="Memory key" disabled={snapshot.saving} />
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Prefer short answers." aria-label="Memory value" disabled={snapshot.saving} />
          <button type="submit" className="secondary" disabled={snapshot.saving || !value.trim()}>Remember</button>
        </form>
      )}
      {active.length === 0 ? <p>Nothing is remembered yet. For example, key answer_length and value Prefer short answers.</p> : (
        <ul className="profile-facts">
          {active.map((row) => (
            <li key={row.id}>
              <strong>{row.key}</strong> · {row.kind} · {row.origin} · revision {row.revision}
              <p>{row.value}</p>
              <p>{sourceLine(row)}</p>
              {editing === row.key ? (
                <form className="field" onSubmit={(event) => { event.preventDefault(); void save(row); }}>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`New value for ${row.key}`} />
                  <button type="submit" className="secondary" disabled={snapshot.saving}>Save</button>
                </form>
              ) : (
                <button type="button" className="secondary" disabled={snapshot.saving} onClick={() => { setEditing(row.key); setDraft(row.value); }}>Edit</button>
              )}
              <button type="button" className="secondary" disabled={snapshot.saving} onClick={() => { void forget(row); }}>Forget</button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <ul className="profile-facts">
          {candidates.map((row) => (
            <li key={row.id}>
              <strong>{row.key}</strong>
              <p>{row.value}</p>
              <p>Suggested from an Assistant message. It is not used until you keep it.</p>
              <button type="button" className="secondary" disabled={snapshot.saving} onClick={() => { void keep(row); }}>Keep</button>
              <button type="button" className="secondary" disabled={snapshot.saving} onClick={() => { void remove(row); }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {forgotten.length > 0 && (
        <p>Forgotten, and not sent to a new session: {forgotten.join(", ")}. They stay forgotten after a restart unless you explicitly remember them again.</p>
      )}
      <p>A session that already heard a preference keeps it until that session restarts. Deleting the database row is not the same as the live session forgetting it.</p>
      {notice && <p>{notice}</p>}
      {snapshot.error && <p className="error" role="alert">{snapshot.error}</p>}
    </details>
  );
}

function sourceLine(row: AssistantMemory): string {
  const why = row.origin === "explicit"
    ? "You asked to remember this."
    : "Learned from an Assistant message. An explicit correction replaces it.";
  const from = row.sourceConversationId
    ? "It came from a saved conversation. Forgetting this does not delete that conversation."
    : "No conversation was attached.";
  return `${why} ${from}`;
}

function forgottenKeys(rows: readonly AssistantMemory[]): string[] {
  return [...new Set(rows.filter((row) => row.status === "forgotten").map((row) => row.key))].sort();
}
