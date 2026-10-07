import type { DictationCue } from "@/platform/PlatformAdapter";

interface CueShape {
  fromHz: number;
  toHz: number;
  durationMs: number;
  gain: number;
}

export function dictationCueShape(kind: DictationCue): CueShape {
  return kind === "ready"
    ? { fromHz: 640, toHz: 780, durationMs: 72, gain: 0.028 }
    : { fromHz: 720, toHz: 560, durationMs: 78, gain: 0.026 };
}

let context: AudioContext | null = null;

/**
 * Short, low-volume sine sweep for the Windows WebView. It uses no audio asset and
 * follows the app's normal output device/volume. Failure is intentionally non-fatal.
 */
export async function playWebDictationCue(kind: DictationCue): Promise<void> {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  context ??= new AudioContextClass();
  if (context.state === "suspended") await context.resume();

  const spec = dictationCueShape(kind);
  const start = context.currentTime;
  const end = start + spec.durationMs / 1000;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(spec.fromHz, start);
  oscillator.frequency.linearRampToValueAtTime(spec.toHz, end);

  // Tiny fade-in/out keeps the cue soft and click-free.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(spec.gain, start + 0.012);
  gain.gain.setValueAtTime(spec.gain, Math.max(start + 0.013, end - 0.020));
  gain.gain.linearRampToValueAtTime(0, end);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end);
}
