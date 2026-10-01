/**
 * Withholds microphone audio while Assistant playback is still audible, then for a
 * short configured tail. The tail is speaker ring-down after the playback head
 * reaches the end. It is not a speech detector and it does not wait for `turnComplete`,
 * because queued audio can still be coming out of the speaker after that event.
 */
export const ECHO_TAIL_MS = 160;

export interface EchoGate {
  duplex: boolean;
  remainingMs: number;
  /** Wall-clock time when the post-playback hold ends. Zero means there is no hold. */
  holdUntil: number;
}

export function duplexEchoGate(): EchoGate {
  return { duplex: true, remainingMs: 0, holdUntil: 0 };
}

export function gatedEchoGate(): EchoGate {
  return { duplex: false, remainingMs: 0, holdUntil: 0 };
}

/**
 * `remainingMs` is how long the playback device still has audio, measured from its clock.
 * Crossing from audible to silent starts the tail once. Later polls must not extend it.
 */
export function noteRemaining(gate: EchoGate, now: number, remainingMs: number, tailMs = ECHO_TAIL_MS): EchoGate {
  if (gate.duplex) return gate;
  const remaining = Math.max(0, remainingMs);
  if (remaining > 0) return { ...gate, remainingMs: remaining, holdUntil: 0 };
  if (gate.remainingMs > 0) return { ...gate, remainingMs: 0, holdUntil: now + tailMs };
  return gate;
}

export function shouldForwardMicrophone(gate: EchoGate, now: number): boolean {
  if (gate.duplex) return true;
  if (gate.remainingMs > 0) return false;
  return gate.holdUntil === 0 || now >= gate.holdUntil;
}

export function microphoneHeld(gate: EchoGate, now: number): boolean {
  return !shouldForwardMicrophone(gate, now);
}
