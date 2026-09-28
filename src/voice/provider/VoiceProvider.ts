/** Application events; provider wire formats must stay inside the implementation. */
export type TranscriptionEvent =
  | { type: "connected" }
  | { type: "partialTranscript"; text: string }
  | { type: "finalTranscript"; text: string }
  /** `retryable: false` means recovery would fail the same way (bad credential, rejected config). */
  | { type: "error"; message: string; retryable: boolean }
  | { type: "closed" };

/** User choices every provider must honor; each implementation maps them to its own setup. */
export interface TranscriptionPreferences {
  smart: boolean;
  /** BCP-47 code, or `null` for automatic detection. */
  language: string | null;
  vocabulary: string[];
}

export interface TranscriptionSession {
  connect(): Promise<void>;
  startUtterance(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): Promise<void>;
  endUtterance(): Promise<void>;
  close(): Promise<void>;
}

export interface VoiceProvider {
  createSession(onEvent: (event: TranscriptionEvent) => void): TranscriptionSession;
  /**
   * Same-provider transcription of a whole buffered utterance (PCM16 mono, 16 kHz).
   * Used to recover when the live session fails.
   */
  transcribeRecording?(pcm: ArrayBuffer, signal: AbortSignal): Promise<string>;
}
