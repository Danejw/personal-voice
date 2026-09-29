export type MicrophoneOwner = "dictation" | "assistant";

/**
 * One microphone at a time. The holder may claim again. The other owner is refused
 * until `release`. DictationController is not involved; capture is gated around it.
 */
export class MicrophoneLease {
  private owner: MicrophoneOwner | null = null;

  claim(owner: MicrophoneOwner): boolean {
    if (this.owner !== null && this.owner !== owner) return false;
    this.owner = owner;
    return true;
  }

  release(owner: MicrophoneOwner): void {
    if (this.owner === owner) this.owner = null;
  }

  heldBy(): MicrophoneOwner | null {
    return this.owner;
  }
}
