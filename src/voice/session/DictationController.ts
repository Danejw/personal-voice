import type { AudioCapture } from "@/voice/audio/AudioCapture";
import { concatPcm, PCM_BYTES_PER_MS } from "@/voice/audio/pcm";
import type { TranscriptionEvent, TranscriptionSession, VoiceProvider } from "@/voice/provider/VoiceProvider";
import { initialVoiceState, voiceReducer } from "@/voice/session/state";
import type { VoiceAction, VoiceState } from "@/voice/session/state";
import { timingsFrom } from "@/voice/session/timings";
import type { UtteranceMarks, UtteranceTimings } from "@/voice/session/timings";
import type { TranscriptDestination } from "@/voice/transcript/TranscriptDestination";

export interface DictationSnapshot {
  state: VoiceState;
  /** Live hypothesis for the current utterance; cleared once the final transcript lands. */
  partial: string;
  /** Last finalized utterance. */
  transcript: string;
  error: string | null;
  /** Increments per start, so observers can tell two identical failures apart. */
  utterance: number;
}

export const initialDictationSnapshot: DictationSnapshot = {
  state: initialVoiceState, partial: "", transcript: "", error: null, utterance: 0,
};

export interface DictationLimits {
  /** Shorter recordings are treated as an accidental tap and discarded silently. */
  minAudioBytes: number;
  /** Recording auto-stops (and transcribes) at this length. */
  maxUtteranceMs: number;
  /** After release, how long to wait for a still-connecting live session before recovering. */
  connectGraceMs: number;
  /** Recovery may run at about real time, so the utterance's own duration is added to this. */
  recoveryTimeoutMs: number;
}

export const defaultDictationLimits: DictationLimits = {
  minAudioBytes: 250 * PCM_BYTES_PER_MS,
  maxUtteranceMs: 300_000,
  connectGraceMs: 2_000,
  recoveryTimeoutMs: 30_000,
};

export type DictationSettledOutcome = "delivered" | "cancelled" | "failed";

export interface DictationSettledEvent {
  utterance: number;
  outcome: DictationSettledOutcome;
}

export interface DictationOptions extends Partial<DictationLimits> {
  /** Called once per delivered utterance with its stage durations. */
  onTimings?: (timings: UtteranceTimings, transcript: string) => void;
  /** Called once when the utterance truly reaches a terminal outcome, never merely on button release. */
  onSettled?: (event: DictationSettledEvent) => void;
  now?: () => number;
}

/** The live streaming path for one utterance. Once `lost`, only recovery can produce its transcript. */
type LivePath =
  | { kind: "connecting"; session: TranscriptionSession }
  | { kind: "streaming"; session: TranscriptionSession }
  | { kind: "ending"; session: TranscriptionSession }
  | { kind: "lost" };

/** Everything owned by one press-to-release. Discarded as a whole on delivery, cancel, or failure. */
interface Utterance {
  provider: VoiceProvider;
  capture: AudioCapture;
  live: LivePath;
  /** In-memory PCM for recovery; never persisted, dropped when the utterance resolves. */
  audio: ArrayBuffer[];
  bytes: number;
  /** How many `audio` chunks the live session has received. */
  sent: number;
  /** Set on release; resolves once trailing audio has been captured. */
  flushed?: Promise<void>;
  recovery?: Promise<void>;
  abort?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  marks: UtteranceMarks;
}

/** Shown when the provider heard no words; a mic that is muted or too quiet looks like this. */
export const NO_SPEECH = "No speech detected. Check your microphone and try again.";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.";
}

/**
 * Runs one utterance at a time: capture → provider session → final transcript → destination.
 * Audio is buffered locally until the utterance resolves, so a failed live session can be
 * recovered with the same provider. Every async continuation checks that its utterance is
 * still current, so stale output can never be delivered.
 */
export class DictationController {
  private snapshot = initialDictationSnapshot;
  private utt?: Utterance;
  private limits: DictationLimits;
  private onTimings?: (timings: UtteranceTimings, transcript: string) => void;
  private onSettled?: (event: DictationSettledEvent) => void;
  private settledUtterance = 0;
  private now: () => number;

  constructor(
    private createCapture: () => AudioCapture,
    private onChange: (snapshot: DictationSnapshot) => void,
    private destination: TranscriptDestination,
    { onTimings, onSettled, now = () => performance.now(), ...limits }: DictationOptions = {},
  ) {
    this.limits = { ...defaultDictationLimits, ...limits };
    this.onTimings = onTimings;
    this.onSettled = onSettled;
    this.now = now;
  }

  get current(): DictationSnapshot {
    return this.snapshot;
  }

  /** Push-to-talk press: a previous error never blocks the next utterance. */
  async press(provider: VoiceProvider): Promise<void> {
    this.reset();
    await this.start(provider);
  }

  /** Must be called directly from the user gesture (or push-to-talk) so audio capture may start. */
  async start(provider: VoiceProvider): Promise<void> {
    if (this.snapshot.state !== "IDLE") return;
    const marks: UtteranceMarks = { pressed: this.now() };
    this.dispatch({ type: "start" }, { partial: "", transcript: "", error: null, utterance: this.snapshot.utterance + 1 });

    let utt: Utterance | undefined;
    let session: TranscriptionSession;
    try {
      session = provider.createSession((event) => { if (utt) this.handleEvent(utt, event); });
    } catch (error) {
      await this.fail(error);
      return;
    }
    const current: Utterance = utt = this.utt = {
      provider, capture: this.createCapture(), live: { kind: "connecting", session }, audio: [], bytes: 0, sent: 0, marks,
    };

    // Capture starts before any await so it stays inside the user gesture.
    const capturing = current.capture.start(
      (chunk) => this.handleChunk(current, chunk),
      (message) => { if (current === this.utt) void this.fail(message); },
    );
    void this.connectLive(current, session);
    try {
      await capturing;
    } catch (error) {
      if (current === this.utt) await this.fail(error);
      return;
    }
    const state = this.state();
    if (current !== this.utt || (state !== "CONNECTING" && state !== "LISTENING")) return;
    current.timer = setTimeout(() => { if (current === this.utt) void this.stop(); }, this.limits.maxUtteranceMs);
  }

  /** Push-to-talk release: finishes the utterance, even if the live session is still connecting. */
  async stop(): Promise<void> {
    const utt = this.utt;
    const state = this.snapshot.state;
    if (!utt || (state !== "CONNECTING" && state !== "LISTENING")) return;
    clearTimeout(utt.timer);
    utt.marks.released = this.now();
    this.dispatch({ type: "finish" });
    try {
      // Trailing audio must reach the buffer (and live session) before the end of speech is signalled.
      await (utt.flushed = utt.capture.stop(true));
    } catch (error) {
      if (utt === this.utt) await this.fail(error);
      return;
    }
    if (utt !== this.utt || this.state() !== "FINALIZING") return;
    if (utt.bytes < this.limits.minAudioBytes) {
      this.dispatch({ type: "cancel" }, { partial: "" });
      await this.release();
      this.settle("cancelled");
      return;
    }
    this.finalize(utt);
  }

  /** Abandons the utterance before delivery; nothing is delivered, including a pending recovery. */
  async cancel(): Promise<void> {
    const state = this.snapshot.state;
    if (state !== "CONNECTING" && state !== "LISTENING" && state !== "FINALIZING") return;
    this.dispatch({ type: "cancel" }, { partial: "" });
    await this.release();
    this.settle("cancelled");
  }

  /** Leaves ERROR so the user can record again. */
  reset(): void {
    if (this.snapshot.state !== "ERROR") return;
    this.dispatch({ type: "reset" }, { partial: "", error: null });
  }

  /** Cancels any in-flight utterance without surfacing an error. */
  async dispose(): Promise<void> {
    await this.release();
  }

  private async connectLive(utt: Utterance, session: TranscriptionSession) {
    try {
      await session.connect();
      if (utt !== this.utt || utt.live.kind !== "connecting") return;
      await session.startUtterance();
      for (let chunk = utt.audio[utt.sent]; chunk; chunk = utt.audio[utt.sent]) {
        utt.sent++;
        await session.sendAudio(chunk);
      }
      if (utt !== this.utt || utt.live.kind !== "connecting") return;
      utt.live = { kind: "streaming", session };
      utt.marks.live = this.now();
      if (this.state() === "CONNECTING") this.dispatch({ type: "connected" });
      if (utt.flushed) {
        await utt.flushed;
        this.finalize(utt);
      }
    } catch (error) {
      this.liveLost(utt, messageOf(error), true);
    }
  }

  /** Called once the user has released and trailing audio is buffered. */
  private finalize(utt: Utterance) {
    if (utt !== this.utt || this.state() !== "FINALIZING") return;
    const { live } = utt;
    switch (live.kind) {
      case "connecting":
        clearTimeout(utt.timer);
        utt.timer = setTimeout(() => this.liveLost(utt, "Transcription took too long to connect.", true), this.limits.connectGraceMs);
        return;
      case "streaming":
        clearTimeout(utt.timer);
        void this.endLive(utt, live.session);
        return;
      case "ending":
        return;
      case "lost":
        void this.recover(utt);
        return;
      default: {
        const unhandled: never = live;
        throw new Error(`Unhandled live path: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async endLive(utt: Utterance, session: TranscriptionSession) {
    utt.live = { kind: "ending", session };
    try {
      await session.endUtterance();
    } catch (error) {
      this.liveLost(utt, messageOf(error), true);
    }
  }

  /** The live path failed. Keep recording if the user is still speaking; recover once released. */
  private liveLost(utt: Utterance, message: string, retryable: boolean) {
    if (utt !== this.utt || utt.live.kind === "lost") return;
    clearTimeout(utt.timer);
    void utt.live.session.close();
    utt.live = { kind: "lost" };
    if (!retryable || !utt.provider.transcribeRecording) {
      void this.fail(message);
      return;
    }
    if (this.state() === "FINALIZING") void this.recover(utt);
  }

  private recover(utt: Utterance): Promise<void> {
    utt.recovery ??= this.runRecovery(utt);
    return utt.recovery;
  }

  private async runRecovery(utt: Utterance) {
    // A failed flush is reported by `stop`.
    try { await utt.flushed; } catch { return; }
    const { provider } = utt;
    if (utt !== this.utt || this.state() !== "FINALIZING" || !provider.transcribeRecording) return;
    const abort = utt.abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.limits.recoveryTimeoutMs + utt.bytes / PCM_BYTES_PER_MS);
    let text: string;
    try {
      text = await provider.transcribeRecording(concatPcm(utt.audio), abort.signal);
    } catch (error) {
      if (utt === this.utt) await this.fail(abort.signal.aborted ? "Transcription timed out. Please try again." : error);
      return;
    } finally {
      clearTimeout(timeout);
    }
    await this.deliver(utt, text);
  }

  private handleChunk(utt: Utterance, chunk: ArrayBuffer) {
    const state = this.snapshot.state;
    if (utt !== this.utt || (state !== "CONNECTING" && state !== "LISTENING" && state !== "FINALIZING")) return;
    utt.marks.audio ??= this.now();
    utt.audio.push(chunk);
    utt.bytes += chunk.byteLength;
    const { live } = utt;
    if (live.kind !== "streaming") return;
    utt.sent++;
    live.session.sendAudio(chunk).catch((error: unknown) => this.liveLost(utt, messageOf(error), true));
  }

  private handleEvent(utt: Utterance, event: TranscriptionEvent) {
    if (utt !== this.utt || utt.live.kind === "lost") return;
    switch (event.type) {
      case "partialTranscript":
        if (this.snapshot.state === "LISTENING" || this.snapshot.state === "FINALIZING") this.update({ partial: event.text });
        return;
      case "finalTranscript":
        // Only a final answering our end-of-speech counts; `deliver` ignores duplicates.
        if (utt.live.kind === "ending") void this.deliver(utt, event.text);
        return;
      case "error":
        this.liveLost(utt, event.message, event.retryable);
        return;
      case "connected":
      case "closed":
        return;
      default: {
        const unhandled: never = event;
        throw new Error(`Unhandled transcription event: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** On destination failure the transcript stays in the snapshot so the user can still copy it. */
  private async deliver(utt: Utterance, raw: string) {
    if (utt !== this.utt || this.state() !== "FINALIZING") return;
    const text = raw.trim();
    if (!text) {
      await this.fail(NO_SPEECH);
      return;
    }
    const { marks } = utt;
    marks.final = this.now();
    const recovered = utt.live.kind === "lost";
    this.dispatch({ type: "transcribed" }, { partial: "", transcript: text });
    void this.release();
    try {
      await this.destination.deliver(text);
      this.dispatch({ type: "delivered" });
      this.settle("delivered");
      const timings = timingsFrom(marks, this.now(), recovered);
      if (timings) this.onTimings?.(timings, text);
    } catch (error) {
      await this.fail(error);
    }
  }

  private async fail(error: unknown) {
    if (this.snapshot.state === "IDLE" || this.snapshot.state === "ERROR") return;
    this.dispatch({ type: "fail" }, { partial: "", error: messageOf(error) });
    await this.release();
    this.settle("failed");
  }

  private settle(outcome: DictationSettledOutcome) {
    const utterance = this.snapshot.utterance;
    if (utterance <= 0 || utterance === this.settledUtterance) return;
    this.settledUtterance = utterance;
    try {
      this.onSettled?.({ utterance, outcome });
    } catch {
      // Cleanup/observers must never change the dictation outcome.
    }
  }

  private async release() {
    const utt = this.utt;
    this.utt = undefined;
    if (!utt) return;
    clearTimeout(utt.timer);
    utt.abort?.abort();
    utt.audio = [];
    const { live } = utt;
    await Promise.allSettled([utt.capture.stop(false), live.kind === "lost" ? undefined : live.session.close()]);
  }

  /** Unnarrowed read: the state can change across awaits. */
  private state(): VoiceState {
    return this.snapshot.state;
  }

  private dispatch(action: VoiceAction, patch: Partial<Omit<DictationSnapshot, "state">> = {}) {
    this.update({ ...patch, state: voiceReducer(this.snapshot.state, action) });
  }

  private update(patch: Partial<DictationSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.snapshot);
  }
}
