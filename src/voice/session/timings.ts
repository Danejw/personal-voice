/**
 * Stage durations for one delivered utterance, in milliseconds. Latency measurement only:
 * it never carries transcript content. A stage that didn't happen is `null`.
 */
export interface UtteranceTimings {
  /** Press → first microphone chunk. Speech before this point is not captured. */
  pressToAudio: number | null;
  /** Press → live session ready for audio. `null` when it never became ready. */
  pressToLive: number | null;
  /** Release → final transcript, live or recovered. */
  releaseToFinal: number;
  /** Final transcript → selected destination finished. */
  finalToDelivered: number;
  /** Press → destination finished. Includes speaking, transcription, and delivery. */
  totalMs: number;
  /**
   * First captured microphone chunk → recording stop.
   * `null` when either mark is missing or the interval is not positive.
   * This is the speaking-speed interval. It is not `totalMs`.
   */
  recordingMs: number | null;
  /** The transcript came from replaying the buffered audio. */
  recovered: boolean;
}

/** Timestamps (from the controller's clock) collected while an utterance runs. */
export interface UtteranceMarks {
  pressed: number;
  audio?: number;
  live?: number;
  released?: number;
  final?: number;
}

function since(start: number | undefined, end: number | undefined): number | null {
  return start === undefined || end === undefined ? null : Math.round(end - start);
}

/** `null` until the utterance has been released, transcribed, and delivered. */
export function timingsFrom(marks: UtteranceMarks, delivered: number, recovered: boolean): UtteranceTimings | null {
  const releaseToFinal = since(marks.released, marks.final);
  const finalToDelivered = since(marks.final, delivered);
  if (releaseToFinal === null || finalToDelivered === null) return null;
  const recorded = since(marks.audio, marks.released);
  return {
    pressToAudio: since(marks.pressed, marks.audio),
    pressToLive: since(marks.pressed, marks.live),
    releaseToFinal,
    finalToDelivered,
    totalMs: Math.round(delivered - marks.pressed),
    recordingMs: recorded !== null && recorded > 0 ? recorded : null,
    recovered,
  };
}

/** One line for a dev console, e.g. `press→audio 180 ms · … · final→delivered 30 ms`. */
export function formatTimings(timings: UtteranceTimings): string {
  const ms = (value: number | null) => (value === null ? "–" : `${value} ms`);
  return [
    `press→audio ${ms(timings.pressToAudio)}`,
    `press→live ${ms(timings.pressToLive)}`,
    `release→final ${ms(timings.releaseToFinal)}${timings.recovered ? " (recovered)" : ""}`,
    `final→delivered ${ms(timings.finalToDelivered)}`,
  ].join(" · ");
}
