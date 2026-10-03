import type { TranscriptDestination } from "@/voice/transcript/TranscriptDestination";

export interface LockedRemoteTarget {
  id: string;
  name: string;
}

export interface RemoteDictationSender {
  send(transcript: string, target: LockedRemoteTarget): Promise<void>;
}

/**
 * Delivers a finalized transcript to the target locked when the utterance began.
 * Resolving the target only at delivery time would allow mid-utterance redirects.
 */
export class RemoteDictationDestination implements TranscriptDestination {
  private locked: LockedRemoteTarget | null = null;

  constructor(private sender: RemoteDictationSender) {}

  /** Call when hold/press begins. Later target cycling must not change this utterance. */
  lockTarget(target: LockedRemoteTarget): void {
    this.locked = { id: target.id, name: target.name };
  }

  clearLock(): void {
    this.locked = null;
  }

  get lockedTarget(): LockedRemoteTarget | null {
    return this.locked;
  }

  async deliver(transcript: string): Promise<void> {
    const target = this.locked;
    this.locked = null;
    if (!target) throw new Error("No remote device is selected.");
    const text = transcript.trim();
    if (!text) throw new Error("The transcript is empty or too long.");
    await this.sender.send(text, target);
  }
}
