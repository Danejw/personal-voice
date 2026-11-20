import { useEffect, useRef, useState } from "react";
import { NativeAudioCapture } from "@/platform/android/NativeAudioCapture";
import { callPlugin } from "@/platform/android/voicePlatformPlugin";
import { SpeakerRegistry, type SpeakerRegistrySnapshot } from "./SpeakerRegistry";

const MIN_BYTES = 3 * 16000 * 2;
const MAX_BYTES = 8 * 16000 * 2;
const MODEL = "sherpa-onnx-2.0.1/3dspeaker-eres2net-en-voxceleb/sha256-c4947caf150b8502";
type EmbeddingResult = { modelId: string; embedding: number[] };
type Saved = { payload: string | null };

function toBase64(chunks: ArrayBuffer[]): string {
  const length = chunks.reduce((sum, item) => sum + item.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  bytes.fill(0);
  return btoa(text);
}

/** Opt-in guided recognition; never automatically records bystanders or uploads audio. */
export function AndroidSpeakerSettings({ userId }: { userId: string | null }) {
  const [registry, setRegistry] = useState<SpeakerRegistry | null>(null);
  const [status, setStatus] = useState("Voice recognition is off until you enroll.");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const capture = useRef<NativeAudioCapture | null>(null);
  const chunks = useRef<ArrayBuffer[]>([]);
  const registryRef = useRef<SpeakerRegistry | null>(null);

  useEffect(() => {
    let active = true;
    registryRef.current = null;
    setRegistry(null);
    setStatus("Voice recognition is off until you enroll.");
    if (!userId) return;
    void (async () => {
      try {
        const saved = await callPlugin<Saved>("speaker_profiles_read", { accountId: userId });
        if (!active) return;
        if (!saved.payload) return;
        const snapshot = JSON.parse(saved.payload) as SpeakerRegistrySnapshot;
        const next = new SpeakerRegistry(userId, MODEL, snapshot.dimensions);
        next.restore(snapshot);
        registryRef.current = next;
        setRegistry(next);
        setStatus("Primary voice profile restored. Ready for a recognition test.");
      } catch {
        if (active) setStatus("Couldn't restore your saved voice profile. No profile was changed.");
      }
    })();
    return () => {
      active = false;
      void capture.current?.stop(false);
      capture.current = null;
      chunks.current = [];
      registryRef.current = null;
    };
  }, [userId]);

  async function begin() {
    if (!userId || busy || recording) return;
    const mic = new NativeAudioCapture("dictation");
    chunks.current = [];
    capture.current = mic;
    try {
      await mic.start((pcm) => {
        const current = chunks.current.reduce((sum, part) => sum + part.byteLength, 0);
        if (current < MAX_BYTES) chunks.current.push(pcm);
      }, (message) => setStatus(message));
      setRecording(true);
      setStatus("Speak clearly for 3 to 8 seconds, then tap Finish.");
    } catch (error) {
      capture.current = null;
      setStatus(error instanceof Error ? error.message : "Microphone unavailable.");
    }
  }

  async function finish() {
    if (!userId || !capture.current) return;
    setRecording(false);
    setBusy(true);
    const mic = capture.current;
    capture.current = null;
    try {
      await mic.stop(true);
      const total = chunks.current.reduce((sum, item) => sum + item.byteLength, 0);
      if (total < MIN_BYTES) throw new Error("Record at least 3 seconds of clear speech.");
      const data = toBase64(chunks.current);
      chunks.current = [];
      const result = await callPlugin<EmbeddingResult>("speaker_embedding", { data });
      if (result.modelId !== MODEL) throw new Error("Speaker model version changed. Re-enroll.");
      const current = registryRef.current;
      if (!current) {
        const next = new SpeakerRegistry(userId, MODEL, result.embedding.length);
        next.enroll({ id: "primary", displayName: "Primary user", role: "primary", consentedAt: Date.now(), recordedAt: Date.now(), embedding: result.embedding });
        await callPlugin("speaker_profiles_write", { accountId: userId, payload: JSON.stringify(next.snapshot()) });
        registryRef.current = next;
        setRegistry(next);
        setStatus("Primary voice enrolled and encrypted on this device. Record again to test.");
      } else {
        // Conservative preview thresholds; a match is informational, never authentication.
        const match = current.identify(result.embedding, { minSimilarity: 0.8, minMargin: 0.1 });
        setStatus(match.kind === "identified" ? "Voice test: primary profile matched (experimental)." : "Voice test: unknown or uncertain. Try another clear sample.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Speaker recognition failed.");
    } finally {
      chunks.current = [];
      setBusy(false);
    }
  }

  async function forget() {
    if (!userId || recording || busy) return;
    setBusy(true);
    try {
      await callPlugin("speaker_profiles_forget", { accountId: userId });
      registryRef.current = null;
      setRegistry(null);
      setStatus("Local speaker profile deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Couldn't delete speaker profile.");
    } finally { setBusy(false); }
  }

  return <section className="assistant-pane-intro" aria-label="Voice recognition">
    <span className="assistant-eyebrow">ON-DEVICE VOICE RECOGNITION</span>
    <h4>Primary speaker</h4>
    <p>Opt-in experimental voice recognition. Voice samples are processed on this device; only encrypted voice embeddings are saved. Recognition is not used to authorize actions.</p>
    <p role="status">{status}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {recording
        ? <button type="button" onClick={() => void finish()}>Finish recording</button>
        : <button type="button" disabled={busy || !userId} onClick={() => void begin()}>{registry ? "Test my voice" : "Enroll my voice"}</button>}
      {registry && <button type="button" disabled={busy || recording} onClick={() => void forget()}>Forget voice profile</button>}
    </div>
  </section>;
}
