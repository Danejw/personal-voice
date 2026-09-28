import { describe, expect, it } from "vitest";
import {
  buildOverlaySnapshot,
  clipOverlayText,
  overlayDictateIntent,
  overlayDictationFrom,
  overlayHandoffsFrom,
  overlayNotesFrom,
  parseOverlayAction,
} from "@/overlay/overlay";
import type { Handoff } from "@/handoffs/handoff";
import type { VoiceNote } from "@/notes/voiceNote";

const note = (id: string, status: VoiceNote["status"] = "inbox"): VoiceNote => ({
  id,
  text: `Note ${id} with extra words`,
  sourceDeviceId: "d1",
  status,
  createdAt: "2026-09-28T12:00:00.000Z",
  updatedAt: "2026-09-28T12:00:00.000Z",
});

describe("overlayDictationFrom", () => {
  it("maps the voice machine onto the floating control states", () => {
    expect(overlayDictationFrom("IDLE")).toBe("idle");
    expect(overlayDictationFrom("CONNECTING")).toBe("listening");
    expect(overlayDictationFrom("LISTENING")).toBe("listening");
    expect(overlayDictationFrom("FINALIZING")).toBe("finalizing");
    expect(overlayDictationFrom("INSERTING")).toBe("finalizing");
    expect(overlayDictationFrom("ERROR")).toBe("error");
  });
});

describe("overlayDictateIntent", () => {
  it("starts from idle or error, stops while listening, and waits out transcription", () => {
    expect(overlayDictateIntent("idle")).toBe("start");
    expect(overlayDictateIntent("error")).toBe("start");
    expect(overlayDictateIntent("listening")).toBe("stop");
    expect(overlayDictateIntent("finalizing")).toBe("ignore");
  });
});

describe("overlay lists", () => {
  it("keeps inbox notes and clips only for display", () => {
    expect(overlayNotesFrom([note("1"), note("2", "archived"), note("3")]).map((item) => item.id)).toEqual(["1", "3"]);
    expect(overlayNotesFrom([note("1")])[0]?.text).toBe("Note 1 with extra words");
    expect(clipOverlayText("a".repeat(200)).endsWith("…")).toBe(true);
  });

  it("builds a snapshot the floating control can render", () => {
    const snapshot = buildOverlaySnapshot({
      visible: true,
      state: "LISTENING",
      error: null,
      destination: "voice-note",
      signedIn: true,
      paused: false,
      notes: [note("1")],
      handoffs: [],
      devices: [],
      capture: null,
      notice: null,
    });
    expect(snapshot.dictation).toBe("listening");
    expect(snapshot.destination).toBe("voice-note");
    expect(snapshot.notes).toHaveLength(1);
  });

  it("labels handoffs from the device list", () => {
    const handoff: Handoff = {
      id: "h1",
      text: "Continue elsewhere.",
      sourceDeviceId: "phone",
      targetDeviceId: null,
      createdAt: "2026-09-28T12:00:00.000Z",
      consumedAt: null,
    };
    expect(overlayHandoffsFrom([handoff], [{ id: "phone", name: "Phone", platform: "android", lastSeen: null }])).toEqual([
      { id: "h1", text: "Continue elsewhere.", meta: "Phone" },
    ]);
  });
});

describe("parseOverlayAction", () => {
  it("accepts the overlay commands and ignores anything else", () => {
    expect(parseOverlayAction({ type: "dictate-toggle" })).toEqual({ type: "dictate-toggle" });
    expect(parseOverlayAction({ type: "dictate-hold", phase: "start", destination: "voice-note", id: 1 }))
      .toEqual({ type: "dictate-hold", phase: "start", destination: "voice-note", id: 1 });
    expect(parseOverlayAction({ type: "dictate-hold", phase: "stop", destination: "send-to-device", id: 2 }))
      .toEqual({ type: "dictate-hold", phase: "stop", destination: "send-to-device", id: 2 });
    expect(parseOverlayAction({ type: "dictate-hold", phase: "start", destination: "active-field", id: 1 })).toBeNull();
    expect(parseOverlayAction({ type: "set-destination", destination: "voice-note" }))
      .toEqual({ type: "set-destination", destination: "voice-note" });
    expect(parseOverlayAction({ type: "insert-handoff", id: "h1" })).toEqual({ type: "insert-handoff", id: "h1" });
    expect(parseOverlayAction({ type: "copy-note", id: "n1" })).toEqual({ type: "copy-note", id: "n1" });
    expect(parseOverlayAction({ type: "open-settings" })).toEqual({ type: "open-settings" });
    expect(parseOverlayAction({ type: "set-destination", destination: "nowhere" })).toBeNull();
    expect(parseOverlayAction({ type: "insert-handoff" })).toBeNull();
    expect(parseOverlayAction(null)).toBeNull();
  });
});
