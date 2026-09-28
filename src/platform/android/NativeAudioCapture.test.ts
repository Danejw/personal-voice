import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeAudioCapture, parseCaptureEvent } from "@/platform/android/NativeAudioCapture";

const plugin = vi.hoisted(() => {
  const state: {
    emit: (payload: unknown) => void;
    calls: { command: string; args: unknown }[];
    onStop: (id: number) => void;
  } = { emit: () => undefined, calls: [], onStop: () => undefined };
  return state;
});

vi.mock("@/platform/android/voicePlatformPlugin", () => ({
  listenPlugin: (_event: string, handler: (payload: unknown) => void) => {
    plugin.emit = handler;
    return Promise.resolve(() => { plugin.emit = () => undefined; });
  },
  callPlugin: (command: string, args: { id: number }) => {
    plugin.calls.push({ command, args });
    if (command === "stop_capture") plugin.onStop(args.id);
    return Promise.resolve();
  },
}));

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const bytesOf = (pcm: ArrayBuffer) => [...new Uint8Array(pcm)];

function startedId(): number {
  const call = plugin.calls.find((c) => c.command === "start_capture");
  if (!call) throw new Error("start_capture was not called");
  return (call.args as { id: number }).id;
}

beforeEach(() => {
  plugin.calls = [];
  plugin.onStop = () => undefined;
});

describe("parseCaptureEvent", () => {
  it("decodes chunks and ignores malformed events", () => {
    const chunk = parseCaptureEvent({ id: 3, kind: "chunk", data: b64([1, 2, 255]) });
    expect(chunk?.kind === "chunk" && bytesOf(chunk.pcm)).toEqual([1, 2, 255]);
    expect(parseCaptureEvent({ id: 3, kind: "error", message: "busy" })).toEqual({ id: 3, kind: "error", message: "busy" });
    expect(parseCaptureEvent({ id: 3, kind: "end" })).toEqual({ id: 3, kind: "end" });
    expect(parseCaptureEvent({ kind: "end" })).toBeNull();
    expect(parseCaptureEvent({ id: 3, kind: "chunk" })).toBeNull();
    expect(parseCaptureEvent("end")).toBeNull();
  });
});

describe("NativeAudioCapture", () => {
  it("delivers this capture's chunks and waits for the trailing chunk before stop resolves", async () => {
    const capture = new NativeAudioCapture();
    const chunks: number[][] = [];
    await capture.start((pcm) => chunks.push(bytesOf(pcm)), () => undefined);
    const id = startedId();

    plugin.emit({ id, kind: "chunk", data: b64([1]) });
    plugin.emit({ id: id + 1000, kind: "chunk", data: b64([9]) });
    plugin.onStop = (stopped) => setTimeout(() => {
      plugin.emit({ id: stopped, kind: "chunk", data: b64([2]) });
      plugin.emit({ id: stopped, kind: "end" });
    }, 10);
    await capture.stop(true);

    expect(chunks).toEqual([[1], [2]]);
  });

  it("drops the tail when cancelled and reports errors only while recording", async () => {
    const capture = new NativeAudioCapture();
    const chunks: number[][] = [];
    const errors: string[] = [];
    await capture.start((pcm) => chunks.push(bytesOf(pcm)), (message) => errors.push(message));
    const id = startedId();

    plugin.emit({ id, kind: "error", message: "The microphone is busy or unavailable." });
    plugin.onStop = (stopped) => {
      plugin.emit({ id: stopped, kind: "chunk", data: b64([7]) });
      plugin.emit({ id: stopped, kind: "error", message: "late" });
      plugin.emit({ id: stopped, kind: "end" });
    };
    await capture.stop(false);

    expect(chunks).toEqual([]);
    expect(errors).toEqual(["The microphone is busy or unavailable."]);
  });

  it("never starts native capture when stopped before it was listening", async () => {
    const capture = new NativeAudioCapture();
    const starting = capture.start(() => undefined, () => undefined);
    await capture.stop(true);
    await expect(starting).rejects.toThrow("Recording cancelled.");
    expect(plugin.calls.map((call) => call.command)).not.toContain("start_capture");
  });
});
