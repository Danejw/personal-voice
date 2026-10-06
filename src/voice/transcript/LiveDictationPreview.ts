import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/**
 * An ephemeral, best-effort native editor session. Never persists interim transcripts
 * and never sends them to Notes, history, Assistant, or Remote Dictation.
 *
 * Native implementations may decline previews for editors they cannot safely replace.
 * The final transcript is still delivered through the usual one-shot insertion path.
 */
export class LiveDictationPreview {
  private chain: Promise<void> = Promise.resolve();
  private active = false;
  private inserted = false;
  private unavailable = false;
  private generation = 0;
  private lastText = "";
  private latest = "";
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly platform: Pick<PlatformAdapter, "liveDictationText">) {}

  observe(snapshot: DictationSnapshot, destination: TranscriptDestinationId): void {
    if (snapshot.state === "CONNECTING") {
      this.clearTimer();
      this.generation++;
      this.active = destination === "active-field";
      this.inserted = false;
      this.unavailable = false;
      this.lastText = "";
      this.latest = "";
      // A previous unfinished preview is cleared before another session starts.
      this.enqueue(async () => { await this.platform.liveDictationText("cancel", ""); });
      return;
    }
    if (!this.active) return;
    if (snapshot.state === "LISTENING" || snapshot.state === "FINALIZING") {
      const text = snapshot.partial;
      if (!text || text === this.lastText || this.unavailable) return;
      this.latest = text;
      if (this.pendingTimer === null) {
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          const next = this.latest;
          const token = this.generation;
          if (!this.active || token !== this.generation || next === this.lastText || this.unavailable) return;
          this.lastText = next;
          this.enqueue(async () => {
            const success = await this.platform.liveDictationText("update", next);
            if (token === this.generation) {
              this.inserted ||= success;
              if (!success) this.unavailable = true;
            }
          });
        }, 160);
      }
      return;
    }
    if (snapshot.state === "IDLE" || snapshot.state === "ERROR") this.cancel();
  }

  /** Replaces a provisional hypothesis with the final corrected transcript. */
  async deliver(finalText: string, fallback: () => Promise<void>): Promise<void> {
    this.clearTimer();
    const hadPreview = this.active && this.inserted;
    this.active = false;
    await this.chain;
    if (hadPreview || this.inserted) {
      const succeeded = await this.platform.liveDictationText("commit", finalText).catch(() => false);
      this.inserted = false;
      if (succeeded) return;
      // Focus/editor changed: never paste a duplicate into an unrelated field.
      throw new Error("The input changed during live dictation. The final transcript is available to copy.");
    }
    await fallback();
  }

  cancel(): void {
    this.clearTimer();
    this.active = false;
    this.generation++;
    this.lastText = "";
    this.inserted = false;
    this.unavailable = false;
    this.enqueue(async () => { await this.platform.liveDictationText("cancel", ""); });
  }

  private enqueue(action: () => Promise<void>): void {
    this.chain = this.chain.then(action).catch(() => undefined);
  }

  private clearTimer() {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }
}
