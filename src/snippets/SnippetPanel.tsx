import { useState, type FormEvent } from "react";
import { HoverActionItem } from "@/components/HoverActionItem";
import {
  MAX_SNIPPET_CONTENT_LENGTH,
  MAX_SNIPPET_TRIGGER_LENGTH,
  type Snippet,
} from "@/snippets/snippet";
import type { SnippetSnapshot, SnippetStatus, SnippetStore } from "@/snippets/SnippetStore";

function statusLabel(status: SnippetStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "synced": return "Synced";
    case "offline": return "Offline · cached snippets still work";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled snippet status: ${String(unhandled)}`);
    }
  }
}

export function SnippetToolbar({ store, snapshot }: { store: SnippetStore; snapshot: SnippetSnapshot }) {
  return (
    <div className="page-header-actions">
      <p role="status">{statusLabel(snapshot.status)}</p>
      {snapshot.status !== "signed-out" && (
        <button type="button" className="secondary" disabled={snapshot.status === "loading"} onClick={() => void store.reload()}>
          Refresh
        </button>
      )}
    </div>
  );
}

export function SnippetPanel({ store, snapshot }: { store: SnippetStore; snapshot: SnippetSnapshot }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = snapshot.status === "synced";

  function clearForm() {
    setEditingId(null);
    setTrigger("");
    setContent("");
  }

  function edit(snippet: Snippet) {
    setEditingId(snippet.id);
    setTrigger(snippet.trigger);
    setContent(snippet.content);
    setProblem(null);
    setNotice(null);
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusy(key);
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

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("save", async () => {
      if (editingId) await store.update(editingId, trigger, content);
      else await store.create(trigger, content);
      clearForm();
    }, editingId ? "Snippet updated." : "Snippet saved.");
  }

  function copy(snippet: Snippet) {
    void run(`copy:${snippet.id}`, () => navigator.clipboard.writeText(snippet.content), "Snippet copied.");
  }

  function toggle(snippet: Snippet) {
    void run(
      `toggle:${snippet.id}`,
      () => store.setEnabled(snippet.id, !snippet.enabled),
      snippet.enabled ? "Snippet disabled." : "Snippet enabled.",
    );
  }

  function remove(snippet: Snippet) {
    void run(`delete:${snippet.id}`, async () => {
      await store.remove(snippet.id);
      if (editingId === snippet.id) clearForm();
    }, "Snippet deleted.");
  }

  return (
    <>
      <form className="snippet-form" onSubmit={save}>
        <label className="field stack">
          <span>Voice trigger</span>
          <input
            value={trigger}
            maxLength={MAX_SNIPPET_TRIGGER_LENGTH}
            disabled={!editable || busy !== null}
            placeholder="read only mode"
            onChange={(event) => setTrigger(event.target.value)}
          />
        </label>
        <label className="field stack">
          <span>Expansion</span>
          <textarea
            value={content}
            maxLength={MAX_SNIPPET_CONTENT_LENGTH}
            disabled={!editable || busy !== null}
            placeholder="The full text, instructions, or link you want Personal Voice to insert."
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <p className="hint">Say the whole trigger as one dictation. Matching ignores case, repeated spaces, and trailing punctuation.</p>
        <div className="snippet-form-actions">
          <button type="submit" className="record" disabled={!editable || busy !== null || !trigger.trim() || !content.trim()}>
            {busy === "save" ? "Saving…" : editingId ? "Update snippet" : "Save snippet"}
          </button>
          {editingId && (
            <button type="button" className="secondary" disabled={busy !== null} onClick={clearForm}>Cancel edit</button>
          )}
        </div>
      </form>

      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="snippet-groups page-grow">
        <section className="snippet-group" aria-labelledby="saved-snippets">
          <h3 id="saved-snippets">Saved snippets ({snapshot.snippets.length})</h3>
          {snapshot.snippets.length ? (
            <ul className="snippet-list">
              {snapshot.snippets.map((snippet) => (
                <HoverActionItem
                  key={snippet.id}
                  busy={busy?.endsWith(snippet.id) ?? false}
                  actions={[
                    { kind: "edit", disabled: !editable, onClick: () => edit(snippet) },
                    { kind: "copy", onClick: () => copy(snippet) },
                    { kind: "delete", disabled: !editable, onClick: () => remove(snippet) },
                  ]}
                >
                  <div className={snippet.enabled ? "snippet-card-content" : "snippet-card-content is-disabled"}>
                    <div className="snippet-card-heading">
                      <p className="snippet-trigger">“{snippet.trigger}”</p>
                      <button
                        type="button"
                        className="secondary snippet-toggle"
                        disabled={!editable || busy !== null}
                        onClick={() => toggle(snippet)}
                      >
                        {snippet.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                    <p className="snippet-content">{snippet.content}</p>
                  </div>
                </HoverActionItem>
              ))}
            </ul>
          ) : (
            <p className="placeholder">No snippets yet. Create one above, then say its trigger while dictating.</p>
          )}
        </section>
      </div>
    </>
  );
}
