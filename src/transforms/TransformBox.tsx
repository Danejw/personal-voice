import { useMemo, useState } from "react";
import { SelectField } from "@/components/SelectField";
import type { SelectOption } from "@/components/SelectField";
import { applyTransform } from "@/transforms/applyTransform";
import type { TransformProfile } from "@/transforms/transformProfile";

export interface TransformResultAction {
  label: string;
  run(text: string): Promise<void>;
}

interface TransformBoxProps {
  sourceText: string;
  profiles: readonly TransformProfile[];
  disabled?: boolean;
  initialProfileId?: string | null;
  actions?: readonly TransformResultAction[];
  onClose(): void;
}

/** One-shot transform UI used by Notes, history, and Handoffs. Source text is never changed until an action is chosen. */
export function TransformBox({
  sourceText,
  profiles,
  disabled = false,
  initialProfileId = null,
  actions = [],
  onClose,
}: TransformBoxProps) {
  const defaultId = profiles.some((profile) => profile.id === initialProfileId)
    ? initialProfileId!
    : profiles.find((profile) => profile.id === "builtin:prompt-engineer")?.id
      ?? profiles[0]?.id
      ?? "";
  const [profileId, setProfileId] = useState(defaultId);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const options = useMemo<readonly SelectOption[]>(
    () => profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    [profiles],
  );

  async function run(key: string, action: () => Promise<void>, success?: string) {
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  function transform() {
    const profile = profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      setProblem("Choose a transform first.");
      return;
    }
    void run("transform", async () => {
      setResult(await applyTransform(sourceText, profile));
    });
  }

  function copy() {
    if (!result) return;
    void run("copy", () => navigator.clipboard.writeText(result), "Transformed text copied.");
  }

  return (
    <div className="transform-box">
      <div className="transform-box-controls">
        <SelectField
          label="Transform"
          value={profileId}
          options={options}
          disabled={disabled || busy !== null || !options.length}
          layout="stack"
          onChange={(value) => {
            setProfileId(value);
            setResult("");
            setProblem(null);
            setNotice(null);
          }}
        />
        <div className="transform-box-buttons">
          <button type="button" className="secondary" disabled={disabled || busy !== null || !profileId} onClick={transform}>
            {busy === "transform" ? "Transforming…" : "Apply"}
          </button>
          <button type="button" className="secondary" disabled={busy !== null} onClick={onClose}>Cancel</button>
        </div>
      </div>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p role="status">{notice}</p>}
      {result && (
        <div className="transform-result">
          <p>{result}</p>
          <div className="transform-result-actions">
            <button type="button" className="secondary" disabled={busy !== null} onClick={copy}>Copy</button>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => void run(action.label, () => action.run(result))}
              >
                {busy === action.label ? "Working…" : action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
