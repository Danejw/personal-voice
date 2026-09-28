/**
 * Stage durations for one inserted utterance, in milliseconds. Latency measurement only:
 * it never carries transcript content. A stage that didn't happen is `null`.
 */
export interface UtteranceTimings {
  /** Press → first microphone chunk. Speech before this point is not captured. */
  pressToAudio: number | null;
  /** Press → live session ready for audio. `null` when it never became ready. */
  pressToLive: number | null;
  /** Release → final transcript, live or recovered. */
  releaseToFinal: number;
  /** Final transcript → insertion finished. */
  finalToInserted: number;
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

/** `null` until the utterance has been released, transcribed, and inserted. */
export function timingsFrom(marks: UtteranceMarks, inserted: number, recovered: boolean): UtteranceTimings | null {
  const releaseToFinal = since(marks.released, marks.final);
  const finalToInserted = since(marks.final, inserted);
  if (releaseToFinal === null || finalToInserted === null) return null;
  return {
    pressToAudio: since(marks.pressed, marks.audio),
    pressToLive: since(marks.pressed, marks.live),
    releaseToFinal,
    finalToInserted,
    recovered,
  };
}

/** One line for a dev console, e.g. `press→audio 180 ms · … · final→inserted 30 ms`. */
export function formatTimings(timings: UtteranceTimings): string {
  const ms = (value: number | null) => (value === null ? "–" : `${value} ms`);
  return [
    `press→audio ${ms(timings.pressToAudio)}`,
    `press→live ${ms(timings.pressToLive)}`,
    `release→final ${ms(timings.releaseToFinal)}${timings.recovered ? " (recovered)" : ""}`,
    `final→inserted ${ms(timings.finalToInserted)}`,
  ].join(" · ");
}
