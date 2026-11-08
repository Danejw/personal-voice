import { useEffect, useState } from "react";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";

export interface AudioOutput {
  id: string;
  name: string;
  type: string;
  selected: boolean;
}

export function parseAssistantOutputs(value: unknown): AudioOutput[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { outputs?: unknown }).outputs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AudioOutput =>
    !!item && typeof item === "object" &&
    typeof item.id === "string" && /^(system|audio:\d+)$/.test(item.id) &&
    typeof item.name === "string" && typeof item.type === "string" &&
    typeof item.selected === "boolean",
  ).slice(0, 30);
}

export function AssistantAudioOutputSettings() {
  const [outputs, setOutputs] = useState<AudioOutput[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = outputs.find(o => o.selected)?.id ?? "system";

  async function refresh() {
    setError("");
    try {
      const result = await callPlugin<unknown>("list_assistant_audio_outputs");
      setOutputs(parseAssistantOutputs(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read audio outputs.");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function choose(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await callPlugin<{ message?: string }>("select_assistant_audio_output", { id });
      setMessage(result.message ?? "Output selected.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to change audio output.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="assistant-output-settings" aria-label="Assistant speech output">
      <div className="card-head">
        <h4>Speech output</h4>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={busy}>Refresh</button>
      </div>
      <label htmlFor="assistant-audio-output">Assistant speaker</label>
      <select id="assistant-audio-output" value={selected} disabled={busy || outputs.length === 0}
        onChange={e => void choose(e.target.value)}>
        {(outputs.length ? outputs : [{ id: "system", name: "System default", type: "", selected: true }])
          .map(output => <option key={output.id} value={output.id}>
            {output.name}{output.id === "system" ? "" : " · " + output.type}
          </option>)}
      </select>
      <p className="note-meta">Only connected Android audio outputs appear here, not merely paired Bluetooth devices. Bluetooth media speakers use non-duplex speech: the microphone pauses during replies.</p>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
