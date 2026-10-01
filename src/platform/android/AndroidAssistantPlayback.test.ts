import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidAssistantPlayback, arrayBufferToBase64, parsePlaybackEvent } from "@/platform/android/AndroidAssistantPlayback";

const plugin = vi.hoisted(() => ({
  calls: [] as { command: string; args: unknown }[],
  emit: (() => undefined) as (payload: unknown) => void,
}));

vi.mock("@/platform/android/voicePlatformPlugin", () => ({
  listenPlugin: (_event: string, handler: (payload: unknown) => void) => {
    plugin.emit = handler;
    return Promise.resolve(() => undefined);
  },
  callPlugin: (command: string, args?: unknown) => {
    plugin.calls.push({ command, args });
    return Promise.resolve();
  },
}));

const samples = (count: number) => {
  const pcm = new ArrayBuffer(count * 2);
  new DataView(pcm).setInt16(0, 1, true);
  return pcm;
};

afterEach(() => {
  plugin.calls = [];
  plugin.emit = () => undefined;
  vi.useRealTimers();
});

describe("parsePlaybackEvent", () => {
  it("accepts playback reports and ignores anything else", () => {
    expect(parsePlaybackEvent({ kind: "drained", remainingMs: 0, token: 2 })).toMatchObject({ kind: "drained", token: 2 });
    expect(parsePlaybackEvent({ kind: "duplex", fullDuplex: true, nativePlayback: true })?.fullDuplex).toBe(true);
    expect(parsePlaybackEvent({ kind: "duplex", fullDuplex: "yes" })?.fullDuplex).toBe(false);
    expect(parsePlaybackEvent({ kind: "nope" })).toBeNull();
    expect(parsePlaybackEvent(null)).toBeNull();
  });
});

describe("AndroidAssistantPlayback", () => {
  it("keeps a local audible estimate until the voice track reports the same chunk is done", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const playback = new AndroidAssistantPlayback();
    playback.prime();
    await Promise.resolve();
    const heard = vi.fn();
    playback.onAudibleChange(heard);

    playback.enqueue(samples(4_800), 24_000);
    expect(plugin.calls).toEqual([]);
    expect(playback.pendingMs(0)).toBeCloseTo(200);

    playback.setNativeRoute(true);
    const sent = plugin.calls[0]?.args as { token: number; data: string };
    expect(plugin.calls.map((call) => call.command)).toEqual(["enqueue_assistant_playback"]);
    expect(sent.token).toBe(1);
    expect(sent.data).toBe(arrayBufferToBase64(samples(4_800)));
    expect(playback.pendingMs(200)).toBe(1);
    expect(playback.pendingMs(200 + 250)).toBe(0);

    playback.enqueue(samples(2_400), 24_000);
    const token = (plugin.calls.at(-1)?.args as { token: number }).token;
    plugin.emit({ kind: "drained", remainingMs: 0, token: token - 1 });
    expect(playback.pendingMs(0)).toBeGreaterThan(0);
    plugin.emit({ kind: "drained", remainingMs: 0, token });
    expect(playback.pendingMs(0)).toBe(0);
    expect(heard).toHaveBeenCalled();
  });

  it("ignores a stale cleared event after a newer chunk was queued", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const playback = new AndroidAssistantPlayback();
    playback.prime();
    await Promise.resolve();
    playback.setNativeRoute(true);
    playback.enqueue(samples(4_800), 24_000);
    playback.clear();
    expect(plugin.calls.map((call) => call.command)).toContain("clear_assistant_playback");
    expect(playback.pendingMs(0)).toBe(0);
    playback.enqueue(samples(4_800), 24_000);
    plugin.emit({ kind: "cleared", remainingMs: 0, token: 0 });
    expect(playback.pendingMs(0)).toBeGreaterThan(0);
  });
});
