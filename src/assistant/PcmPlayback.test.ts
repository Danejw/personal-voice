import { describe, expect, it } from "vitest";
import { PcmPlayback } from "@/assistant/PcmPlayback";

interface Started {
  when: number;
  rate: number;
  samples: Float32Array;
  stopped: boolean;
}

function harness() {
  const started: Started[] = [];
  let currentTime = 5;
  let closed = false;
  const playback = new PcmPlayback(() => ({
    get currentTime() { return currentTime; },
    state: closed ? "closed" : "running",
    destination: {},
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const samples = new Float32Array(length);
      return {
        get duration() { return length / sampleRate; },
        getChannelData() { return samples; },
        rate: sampleRate,
        samples,
      };
    },
    createBufferSource() {
      const entry: Started = { when: 0, rate: 0, samples: new Float32Array(), stopped: false };
      const source = {
        buffer: null as { duration: number; getChannelData(): Float32Array; rate?: number; samples?: Float32Array } | null,
        connect() {},
        start(when: number) {
          entry.when = when;
          entry.rate = source.buffer?.rate ?? 0;
          entry.samples = source.buffer?.samples ?? new Float32Array();
          started.push(entry);
        },
        stop() { entry.stopped = true; },
      };
      return source;
    },
    resume() { return Promise.resolve(); },
    close() { closed = true; return Promise.resolve(); },
  }));
  return { playback, started, setTime: (time: number) => { currentTime = time; } };
}

function pcm(samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
}

describe("PcmPlayback", () => {
  it("plays 24 kHz chunks in order and stops them on clear", () => {
    const { playback, started } = harness();
    playback.enqueue(pcm([0, 32767]), 24_000);
    playback.enqueue(pcm([-32768]), 24_000);
    expect(started.map((entry) => entry.when)).toEqual([5, 5 + 2 / 24_000]);
    expect(playback.pendingMs()).toBeCloseTo((3 / 24_000) * 1000);
    expect(started[0]?.rate).toBe(24_000);
    expect(started[0]?.samples[0]).toBe(0);
    expect(started[0]?.samples[1]).toBeCloseTo(32767 / 32768);
    expect(started[1]?.samples[0]).toBe(-1);
    playback.clear();
    expect(started.every((entry) => entry.stopped)).toBe(true);
    playback.enqueue(pcm([1]), 24_000);
    expect(started[2]?.when).toBe(5);
  });

  it("ignores a playback failure", () => {
    const playback = new PcmPlayback(() => { throw new Error("no audio device"); });
    expect(() => playback.enqueue(pcm([1]))).not.toThrow();
    expect(() => playback.prime()).not.toThrow();
    expect(() => playback.clear()).not.toThrow();
  });

  it("resumes a suspended context before playing, so a hidden window can still speak", async () => {
    const started: number[] = [];
    let state = "suspended";
    const playback = new PcmPlayback(() => ({
      get currentTime() { return 0; },
      get state() { return state; },
      destination: {},
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return {
          get duration() { return length / sampleRate; },
          getChannelData() { return new Float32Array(length); },
        };
      },
      createBufferSource() {
        return {
          buffer: null as { duration: number; getChannelData(): Float32Array } | null,
          connect() {},
          start() { started.push(1); },
          stop() {},
        };
      },
      resume() {
        state = "running";
        return Promise.resolve();
      },
      close() { return Promise.resolve(); },
    }));
    playback.enqueue(pcm([1]), 24_000);
    expect(started).toHaveLength(0);
    await Promise.resolve();
    expect(state).toBe("running");
    expect(started).toHaveLength(1);
  });
});
