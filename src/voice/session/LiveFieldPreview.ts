import type { PlatformAdapter } from "@/platform/PlatformAdapter";
import type { DictationSnapshot } from "@/voice/session/DictationController";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/**
 * Serializes provisional writes and the final replacement. An unsupported or changed
 * field never receives destructive cursor/selection guesses from the web layer.
 */
export class LiveFieldPreview {
  private utterance = -1;
  private queue: Promise<void> = Promise.resolve();
  private active = false;
  private unsupported = false;
  private changed = false;
  private latest = "";
  private finished = false;

  constructor(private platform: Pick<PlatformAdapter, "liveDictationText">) {}

  observe(snapshot: DictationSnapshot, destination: TranscriptDestinationId): void {
    if (snapshot.utterance !== this.utterance) {
      // Capture cleanup before resetting per-utterance state. The queued action must
      // not consult this.active later, because a new utterance may already have reset it.
      const cancelPrevious = this.active && !this.finished;
      if (cancelPrevious) {
        this.active = false;
        this.enqueue(async () => {
          await this.platform.liveDictationText("cancel", "").catch(() => false);
        });
      }
      this.utterance = snapshot.utterance;
      this.active = false;
      this.unsupported = false;
      this.changed = false;
      this.latest = "";
      this.finished = false;
    }
    if (snapshot.state === "IDLE" || snapshot.state === "ERROR") {
      if (!this.finished) {
        this.finished = true;
        // Snapshot whether a provisional span exists now. A following utterance may
        // reset this.active before this serialized cleanup reaches the native layer.
        const shouldCancel = this.active;
        if (shouldCancel) {
          this.active = false;
          this.enqueue(async () => {
            await this.platform.liveDictationText("cancel", "").catch(() => false);
          });
        }
      }
      return;
    }
    if (destination !== "active-field" || this.finished || this.unsupported || this.changed) return;
    if ((snapshot.state !== "LISTENING" && snapshot.state !== "FINALIZING") || !snapshot.partial) return;
    if (snapshot.partial === this.latest) return;
    this.latest = snapshot.partial;
    const utterance = this.utterance;
    const partial = snapshot.partial;
    this.enqueue(async () => {
      if (this.unsupported || this.changed || this.finished || utterance !== this.utterance || partial !== this.latest) return;
      const supported = await this.platform.liveDictationText("update", partial).catch(() => false);
      if (!supported) {
        if (this.active) this.changed = true;
        else this.unsupported = true;
      } else {
        this.active = true;
      }
    });
  }

  /** True if the corrected final was already written into the exact provisional span. */
  async commit(finalText: string): Promise<boolean> {
    // Drain all partial updates before the final edit. Marking finished earlier
    // would silently skip queued hypotheses after a fast key release.
    await this.queue;
    this.finished = true;
    if (this.changed) throw new Error("The input field changed while dictating. The final text was not inserted again to avoid duplication.");
    if (!this.active) return false;
    const inserted = await this.platform.liveDictationText("commit", finalText).catch(() => false);
    this.active = false;
    if (!inserted) throw new Error("The input field changed before finalizing. The final text was not inserted again to protect your existing text.");
    return true;
  }

  private enqueue(action: () => Promise<void>): void {
    this.queue = this.queue.then(action, action);
  }
}
