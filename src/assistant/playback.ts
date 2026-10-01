/**
 * Plays Assistant PCM and reports how much is still audible.
 * Android can replace this with voice-communication output so echo cancellation
 * hears the same audio the user hears. Web Audio remains the desktop path.
 */
export interface AssistantPlayback {
  prime(): void;
  enqueue(pcm: ArrayBuffer, sampleRate?: number): void;
  clear(): void;
  /** Milliseconds still audible. Zero once the device has finished this audio. */
  pendingMs?(now?: number): number;
  /** `ready` false plays through the local sink and the mic gate must stay closed while it plays. */
  setNativeRoute?(ready: boolean): void;
  onAudibleChange?(listener: () => void): void;
  /** Later route or effect changes. `nativePlayback` false means later audio uses the local sink. */
  onDuplexChange?(listener: (fullDuplex: boolean, nativePlayback: boolean) => void): void;
}
