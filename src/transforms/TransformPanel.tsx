import { useState, type FormEvent } from "react";
import { ConfirmDialog, useConfirmAction } from "@/components/ConfirmDialog";
import { HoverActionItem } from "@/components/HoverActionItem";
import { BUILT_IN_TRANSFORMS, MAX_TRANSFORM_INSTRUCTION_LENGTH, MAX_TRANSFORM_NAME_LENGTH } from "@/transforms/transformProfile";
import type { TransformProfile } from "@/transforms/transformProfile";
import type { TransformSnapshot, TransformStore, TransformStatus } from "@/transforms/TransformStore";

function statusLabel(status: TransformStatus): string {
  switch (status) {
    case "signed-out": return "Sign in";
    case "loading": return "Loading…";
    case "synced": return "Synced";
    case "offline": return "Offline";
    default: {
      const unhandled: never = status;
      throw new Error(`Unhandled transform status: ${String(unhandled)}`);
    }
  }
}

export function TransformToolbar({ store, snapshot }: { store: TransformStore; snapshot: TransformSnapshot }) {
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

export function TransformPanel({ store, snapshot }: { store: TransformStore; snapshot: TransformSnapshot }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirmAction();
  const editable = snapshot.status === "synced";

  function clearForm() {
    setEditingId(null);
    setName("");
    setInstruction("");
  }

  function edit(profile: TransformProfile) {
    setEditingId(profile.id);
    setName(profile.name);
    setInstruction(profile.instruction);
    setProblem(null);
    setNotice(null);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setProblem(null);
    setNotice(null);
    const action = editingId
      ? store.update(editingId, name, instruction)
      : store.create(name, instruction);
    void action.then(() => {
      setNotice(editingId ? "Transform updated." : "Transform saved.");
      clearForm();
    }).catch((reason: unknown) => {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setBusy(null));
  }

  function remove(profile: TransformProfile) {
    confirm.ask({
      title: "Delete transform?",
      description: `“${profile.name}” and its saved instructions will be removed. Built-in transforms are not affected.`,
      confirmLabel: "Delete transform",
      onConfirm: async () => {
        setBusy(`delete:${profile.id}`);
        setProblem(null);
        setNotice(null);
        try {
          await store.remove(profile.id);
          if (editingId === profile.id) clearForm();
          setNotice("Transform deleted.");
        } catch (reason) {
          setProblem(reason instanceof Error ? reason.message : String(reason));
          throw reason;
        } finally {
          setBusy(null);
        }
      },
    });
  }

  return (
    <>
      <form className="transform-form" onSubmit={save}>
        <label className="field stack">
          <span>Name</span>
          <input
            value={name}
            maxLength={MAX_TRANSFORM_NAME_LENGTH}
            disabled={!editable || busy !== null}
            placeholder="Coding Agent"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field stack">
          <span>Instructions</span>
          <textarea
            value={instruction}
            maxLength={MAX_TRANSFORM_INSTRUCTION_LENGTH}
            disabled={!editable || busy !== null}
            placeholder="Describe exactly how this transform should rewrite text."
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <div className="transform-form-actions">
          <button type="submit" className="record" disabled={!editable || busy !== null || !name.trim() || !instruction.trim()}>
            {busy === "save" ? "Saving…" : editingId ? "Update transform" : "Save transform"}
          </button>
          {editingId && (
            <button type="button" className="secondary" disabled={busy !== null} onClick={clearForm}>Cancel edit</button>
          )}
        </div>
      </form>
      {(problem ?? snapshot.error) && <p className="error" role="alert">{problem ?? snapshot.error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="transform-groups page-grow">
        <section className="transform-group" aria-labelledby="built-in-transforms">
          <h3 id="built-in-transforms">Built in</h3>
          <ul className="transform-list">
            {BUILT_IN_TRANSFORMS.map((profile) => (
              <li key={profile.id} className="transform-card">
                <p className="transform-name">{profile.name}</p>
                <p className="transform-instruction">{profile.instruction}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="transform-group" aria-labelledby="custom-transforms">
          <h3 id="custom-transforms">Custom</h3>
          {snapshot.profiles.length ? (
            <ul className="transform-list">
              {snapshot.profiles.map((profile) => (
                <HoverActionItem
                  key={profile.id}
                  busy={busy === `delete:${profile.id}`}
                  actions={[
                    { kind: "edit", disabled: !editable, onClick: () => edit(profile) },
                    { kind: "delete", disabled: !editable, onClick: () => remove(profile) },
                  ]}
                >
                  <p className="transform-name">{profile.name}</p>
                  <p className="transform-instruction">{profile.instruction}</p>
                </HoverActionItem>
              ))}
            </ul>
          ) : (
            <p className="placeholder">No custom transforms yet.</p>
          )}
        </section>
      </div>
      <ConfirmDialog request={confirm.request} onClose={confirm.dismiss} />
    </>
  );
}
