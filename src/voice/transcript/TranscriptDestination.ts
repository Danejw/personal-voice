/** A target that receives one finalized transcript. */
export interface TranscriptDestination {
  deliver(transcript: string): Promise<void>;
}

/** The destinations available to dictation. */
export type TranscriptDestinationId = "active-field" | "voice-note" | "remote-dictation";
/** Historical wire ID shared with persisted dictations, analytics and older native clients. */
export const NOTE_DESTINATION_ID = "voice-note" as const;

/** Maps a persisted or legacy destination id onto the current set. */
export function migrateDestinationId(value: unknown): TranscriptDestinationId | null {
  if (value === "active-field" || value === "voice-note" || value === "remote-dictation") return value;
  // Pre-Remote-Dictation installs stored immediate device delivery as send-to-device.
  if (value === "send-to-device") return "remote-dictation";
  return null;
}

export interface TranscriptDeliveryResult {
  text: string;
  destination: TranscriptDestinationId;
  outcome: "success" | "failure";
}

/**
 * Resolves the selected destination at delivery time, keeping destination choice
 * out of the transcription engine.
 */
export class TranscriptDestinationRouter implements TranscriptDestination {
  constructor(
  private destinations: Readonly<Record<TranscriptDestinationId, TranscriptDestination>>,
  private selectedId: TranscriptDestinationId = "active-field",
  private onResult?: (result: TranscriptDeliveryResult) => void,
  /** Optional post-transcription rewrite. It runs before the chosen destination receives text. */
  private transform?: (text: string, destination: TranscriptDestinationId) => Promise<string>,
  private overrideId: TranscriptDestinationId | null = null,
) {}

  get selected(): TranscriptDestinationId {
    return this.selectedId;
  }

  /** Active for this utterance, including a push-to-talk one-shot override. */
  get effective(): TranscriptDestinationId {
    return this.overrideId ?? this.selectedId;
  }

  select(destination: TranscriptDestinationId): void {
    this.selectedId = destination;
  }

  /** Applies only to the next `deliver`, then the saved destination is used again. */
  overrideNext(destination: TranscriptDestinationId | null): void {
    this.overrideId = destination;
  }

  async deliver(transcript: string): Promise<void> {
    const destination = this.overrideId ?? this.selectedId;
    this.overrideId = null;
    try {
      const deliveredText = this.transform ? await this.transform(transcript, destination) : transcript;
      await this.destinations[destination].deliver(deliveredText);
      this.report({ text: deliveredText, destination, outcome: "success" });
    } catch (reason) {
      // Preserve the finalized transcript in recovery history when a transform or destination fails.
      this.report({ text: transcript, destination, outcome: "failure" });
      throw reason;
    }
  }

  /** Best-effort local history must never change the delivery outcome. */
  private report(result: TranscriptDeliveryResult): void {
    try {
      this.onResult?.(result);
    } catch {
      // The destination already resolved; history is deliberately non-critical.
    }
  }
}
