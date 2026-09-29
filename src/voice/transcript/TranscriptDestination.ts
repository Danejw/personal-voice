/** A target that receives one finalized transcript. */
export interface TranscriptDestination {
  deliver(transcript: string): Promise<void>;
}

/** The destinations available to dictation in this phase. */
export type TranscriptDestinationId = "active-field" | "voice-note" | "send-to-device";

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
  private overrideId: TranscriptDestinationId | null = null,
) {}

  get selected(): TranscriptDestinationId {
    return this.selectedId;
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
      await this.destinations[destination].deliver(transcript);
      this.report({ text: transcript, destination, outcome: "success" });
    } catch (reason) {
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
