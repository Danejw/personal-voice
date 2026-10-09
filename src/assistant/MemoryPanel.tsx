import { useEffect, useState } from "react";
import { getSupabase } from "@/services/supabase";
import { attachFileToMemory, indexNextMemoryBatch } from "@/services/personalMemoryService";
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
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [notesSearch, setNotesSearch] = useState(false);
  const [dictationSearch, setDictationSearch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!signedIn) { setSettingsLoaded(false); return; }
    const client = getSupabase();
    if (!client) return;
    void (async () => {
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const { data } = await client.from("settings").select("assistant_semantic_search, assistant_recall_notes, assistant_recall_dictations").eq("user_id", user.id).maybeSingle();
      if (!cancelled) {
        setSemanticEnabled(data?.assistant_semantic_search ?? false);
        setNotesSearch(data?.assistant_recall_notes ?? false);
        setDictationSearch(data?.assistant_recall_dictations ?? false);
        setSettingsLoaded(Boolean(data));
      }
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  async function toggleSemantic(enabled: boolean): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    setSemanticBusy(true);
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Sign in to change semantic indexing.");
      const { data, error } = await client.from("settings").update({ assistant_semantic_search: enabled })
        .eq("user_id", user.id).select("user_id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Your account settings are not ready.");
      setSemanticEnabled(enabled);
      setNotice(enabled ? "Other eligible saved content may now be indexed." : "Indexing of other saved content is disabled.");
      if (enabled) void indexNextMemoryBatch().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change semantic search.");
    } finally { setSemanticBusy(false); }
  }

  async function toggleSource(kind: "notes" | "dictations", enabled: boolean): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    setSemanticBusy(true);
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Sign in to manage memory sources.");
      const patch = kind === "notes" ? { assistant_recall_notes: enabled } : { assistant_recall_dictations: enabled };
      const { data, error } = await client.from("settings").update(patch)
        .eq("user_id", user.id).select("user_id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Account settings unavailable.");
      if (kind === "notes") setNotesSearch(enabled);
      else setDictationSearch(enabled);
      setNotice(`${kind === "notes" ? "Notes" : "Dictations"} search ${enabled ? "enabled" : "disabled"}.`);
      if (enabled && semanticEnabled) void indexNextMemoryBatch().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change source preferences.");
    } finally { setSemanticBusy(false); }
  }

  async function enableAll(): Promise<void> {
    const client = getSupabase();
    if (!client) return;
    setSemanticBusy(true);
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("Sign in to update memory preferences.");
      const { data, error } = await client.from("settings").update({
        assistant_semantic_search: true,
        assistant_recall_notes: true,
        assistant_recall_dictations: true,
      }).eq("user_id", user.id).select("user_id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Could not enable memory recall.");
      setSemanticEnabled(true);
      setNotesSearch(true);
      setDictationSearch(true);
      if (!learning) onLearningChange(true);
      setNotice("Memory and recall are enabled. Synced dictation search still requires cloud dictation history.");
      void indexNextMemoryBatch().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update memory preferences.");
    } finally {
      setSemanticBusy(false);
    }
  }

  async function attachMemoryFile(memoryId: string, file: File): Promise<void> {
    setSemanticBusy(true);
    try {
      await attachFileToMemory(memoryId, file);
      setNotice("Saved the private attachment. Indexing up to three pending memory sources.");
      void indexNextMemoryBatch().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the attachment.");
    } finally { setSemanticBusy(false); }
  }

  async function indexPending(): Promise<void> {
    setSemanticBusy(true);
    try {
      const result = await indexNextMemoryBatch();
      setNotice(`Indexed ${result.processed} source(s) with Gemini ${result.dimensions}-dimensional embeddings; ${result.failed} failed. ${result.claimed} claimed.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Memory indexing is unavailable.");
    } finally { setSemanticBusy(false); }
  }
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
    <section className="assistant-memory-settings" aria-label="Memory and recall settings">
      <div className="assistant-settings-card">
        <div className="assistant-settings-card-head">
          <div><span className="assistant-eyebrow">MEMORY</span><h5>Learning & recall</h5></div>
          <span className="assistant-settings-count">4 preferences</span>
        </div>
        <p className="assistant-settings-description">Choose what your Assistant can learn and search. Changes sync with your account.</p>
        {!settingsLoaded && signedIn && <p className="note-meta" role="status">Loading saved recall preferences…</p>}
        {signedIn && settingsLoaded && !(learning && semanticEnabled && notesSearch && dictationSearch) && (
          <button type="button" className="secondary assistant-enable-all" disabled={semanticBusy || snapshot.saving}
            onClick={() => { void enableAll(); }}>Enable all four preferences</button>
        )}
      {signedIn && (
        <Toggle
          label="Learn from Assistant"
          description="Only saved Assistant messages after this is turned on. This does not read voice notes or dictations."
          checked={learning}
          disabled={snapshot.saving || !settingsLoaded}
          onChange={onLearningChange}
        />
      )}
      {signedIn && <Toggle
        label="Semantic search across saved content"
        description="Optional. Search eligible notes and saved Assistant conversations in addition to explicit memories. Other source permissions still apply."
        checked={semanticEnabled}
        disabled={semanticBusy || !settingsLoaded}
        onChange={(enabled) => { void toggleSemantic(enabled); }}
      />}
      {signedIn && <Toggle label="Include saved Notes in search"
        description="Notes stay separate from permanent Assistant memories."
        checked={notesSearch} disabled={semanticBusy || !settingsLoaded}
        onChange={(enabled) => { void toggleSource("notes", enabled); }} />}
      {signedIn && <Toggle label="Include synced Dictations in search"
        description="Requires the separate Sync recent dictations setting. Never uploads local-only history."
        checked={dictationSearch} disabled={semanticBusy || !settingsLoaded}
        onChange={(enabled) => { void toggleSource("dictations", enabled); }} />}
      </div>
      <details className="fold assistant-stored-memories">
        <summary>Saved memories{active.length ? ` · ${active.length}` : ""} and advanced indexing</summary>
        <p>These follow your account across devices. Existing memories aren't changed when you toggle search settings.</p>
        {signedIn && <p className="note-meta">Private memory attachments use Gemini Embedding 2. Indexing happens only for eligible saved content.</p>}
        {signedIn && <button type="button" className="secondary" disabled={semanticBusy} onClick={() => { void indexPending(); }}>Index next three memories</button>}
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
              <label className="field">Attach image, audio, video, or PDF
                <input type="file" accept=".jpg,.jpeg,.png,.mp3,.wav,.mp4,.mov,.pdf" disabled={snapshot.saving || semanticBusy}
                  onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void attachMemoryFile(row.id, file); event.currentTarget.value = ""; }} />
              </label>
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
    </section>
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
