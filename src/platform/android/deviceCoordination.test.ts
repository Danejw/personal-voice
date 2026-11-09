import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  androidDeviceEnvironment, manageAndroidScreenShare, readAudioEvidence,
  readScreenEvidence, readBluetoothSpeakerHandoff, routeAssistantAudio,
} from "@/platform/android/deviceCoordination";

const native = vi.hoisted(() => vi.fn());
vi.mock("@/platform/android/voicePlatformPlugin", () => ({ callPlugin: native }));

const audio = {
  outputs: [
    { id: "system", name: "System default", type: "Automatic", selected: false },
    { id: "audio:31", name: "Echo Dot", type: "Bluetooth media (A2DP)", selected: true },
  ],
  assistantSessionActive: true,
  nativeTrackRoutedDeviceId: 31,
  routeMatchesSelected: true,
};
const screen = { active: true, url: "http://192.168.0.5:3009/watch/secret-private-token",
  browserConnected: true, framesWritten: 12, frameAgeMs: 100 };

beforeEach(() => {
  native.mockReset();
  native.mockImplementation(async (name: string) => {
    if (name === "list_assistant_audio_outputs") return audio;
    if (name === "screen_share_status") return screen;
    if (name === "bluetooth_speaker_status") return {
      state: "connect_in_android", deviceId: "bt-abcdef012345abcdef012345",
      name: "Echo Dot", selectedOutputId: null, routeObserved: false,
      needsAndroidInteraction: true, message: "Connect Echo Dot in Android Settings."
    };
    if (name === "select_assistant_audio_output") return { message: "Selected" };
    if (name === "start_screen_share") return { active: true };
    if (name === "stop_screen_share") return { active: false };
    throw new Error("Unexpected native command " + name);
  });
});

describe("Android device coordination evidence", () => {
  it("reports speaker connection handoff without exposing any hardware address", () => {
    const status = readBluetoothSpeakerHandoff({
      state: "connect_in_android", deviceId: "bt-abcdef012345abcdef012345",
      name: "Echo Dot", routeObserved: false, needsAndroidInteraction: true,
    });
    expect(status).toMatchObject({ state: "connect_in_android",
      needsAndroidInteraction: true, routeObserved: false });
    expect(readBluetoothSpeakerHandoff({ state: "fabricated", deviceId: "AA:BB:CC" }))
      .toMatchObject({ state: "idle", deviceId: null });
  });

  it("separates native track observation from a selected but disconnected speaker", () => {
    expect(readAudioEvidence(audio)).toMatchObject({
      nativeTrackRoutedDeviceId: 31, routeMatchesSelected: true,
    });
    expect(readAudioEvidence({ ...audio, assistantSessionActive: false }).routeMatchesSelected).toBe(false);
    expect(readAudioEvidence({ outputs: "malformed" }).outputs).toEqual([]);
    expect(readAudioEvidence({ outputs: [{ id: "bt-abcdef", name: "Paired",
      type: "Bluetooth", selected: true }] }).outputs).toEqual([]);
  });

  it("reports browser and frames only for an active stream, and never exports its secret token", async () => {
    expect(readScreenEvidence(screen)).toMatchObject({ active: true, browserConnected: true, framesWritten: 12 });
    expect(readScreenEvidence({ ...screen, active: false })).toMatchObject({
      active: false, browserConnected: false, framesWritten: 0, linkAvailable: false,
    });
    const report = JSON.parse(await androidDeviceEnvironment());
    expect(report.screen_share).toMatchObject({ active: true, browserConnected: true, framesWritten: 12 });
    expect(report.available_audio_outputs[1]).toMatchObject({ name: "Echo Dot", id: "audio:31" });
    expect(report.bluetooth_speaker_handoff).toMatchObject({
      state: "connect_in_android", routeObserved: false, needsAndroidInteraction: true,
    });
    expect(JSON.stringify(report)).not.toContain("secret-private-token");
    expect(JSON.stringify(report)).not.toContain("/watch/");
  });

  it("refuses a fabricated or disconnected audio target", async () => {
    await expect(routeAssistantAudio("bt-deadbeef")).rejects.toThrow(/real audio output/i);
    await expect(routeAssistantAudio("audio:93")).rejects.toThrow(/isn't connected/i);
    expect(native).not.toHaveBeenCalledWith("select_assistant_audio_output", expect.anything());
  });

  it("selects a current sink but doesn't assert audible sound from the native acknowledgement", async () => {
    const reply = JSON.parse(await routeAssistantAudio("audio:31"));
    expect(native).toHaveBeenCalledWith("select_assistant_audio_output", { id: "audio:31" });
    expect(reply).toMatchObject({
      selected_output: { id: "audio:31", name: "Echo Dot" },
      result: "native_track_reports_expected_route",
    });
    expect(reply.note).not.toContain("verified audible");
  });

  it("requires native share start, never includes the URL token in tool results, and reads status", async () => {
    const started = JSON.parse(await manageAndroidScreenShare("start"));
    expect(native).toHaveBeenCalledWith("screen_share_status");
    // An already-active stream doesn't request another MediaProjection consent.
    expect(native).not.toHaveBeenCalledWith("start_screen_share");
    expect(started.status).toBe("already_active");
    expect(JSON.stringify(started)).not.toContain("secret-private-token");

    native.mockImplementation(async (name: string) => {
      if (name === "screen_share_status") return { ...screen, active: false };
      if (name === "start_screen_share") return { active: true };
      throw new Error("Unexpected " + name);
    });
    await expect(manageAndroidScreenShare("start")).rejects.toThrow(/did not remain active/);
    expect(native).toHaveBeenCalledWith("start_screen_share");
  });
});
