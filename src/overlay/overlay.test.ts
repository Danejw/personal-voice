import { describe, expect, it } from "vitest";
import { buildContinuation } from "@/assistant/continuation";
import {
  buildOverlaySnapshot,
  clipOverlayText,
  overlayAssistantFrom,
  overlayAssistantIntent,
  overlayAssistantInterrupt,
  overlayDictateIntent,
  overlayDictationFrom,
  overlayHandoffsFrom,
  overlayKeepsWebViewAwake,
  overlayNotesFrom,
  overlayToggleTarget,
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
      assistant: "idle",
      assistantError: null,
      selectionPreview: null,
      selectionSource: null,
      pendingTitle: null,
      pendingPreview: null,
      pendingWorking: false,
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
    const built = buildContinuation({
      turns: [{ role: "user", text: "The cross-device code word is pineapple seven." }],
      selection: null,
      notes: [],
      handoff: null,
      screen: null,
      sourceDeviceId: "phone",
      sourceDeviceName: "Phone",
      createdAt: "2026-09-28T12:00:00.000Z",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const continuation: Handoff = { ...handoff, text: built.text };
    expect(overlayHandoffsFrom([continuation], [{ id: "phone", name: "Phone", platform: "android", lastSeen: null }])[0]?.text)
      .toBe("The cross-device code word is pineapple seven.");
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
    expect(parseOverlayAction({ type: "assistant-toggle" })).toEqual({ type: "assistant-toggle" });
    expect(parseOverlayAction({ type: "assistant-interrupt" })).toEqual({ type: "assistant-interrupt" });
    expect(parseOverlayAction({ type: "detach-selection" })).toEqual({ type: "detach-selection" });
    expect(parseOverlayAction({ type: "confirm-action" })).toEqual({ type: "confirm-action" });
    expect(parseOverlayAction({ type: "cancel-action" })).toEqual({ type: "cancel-action" });
    expect(parseOverlayAction({ type: "set-destination", destination: "nowhere" })).toBeNull();
    expect(parseOverlayAction({ type: "insert-handoff" })).toBeNull();
    expect(parseOverlayAction(null)).toBeNull();
  });
});

describe("assistant quick access", () => {
  it("routes the Assistant button separately from dictation", () => {
    expect(overlayToggleTarget({ type: "assistant-toggle" })).toBe("assistant");
    expect(overlayToggleTarget({ type: "dictate-toggle" })).toBe("dictation");
    expect(overlayToggleTarget({ type: "open-settings" })).toBeNull();
    expect(overlayAssistantIntent("idle")).toBe("start");
    expect(overlayAssistantIntent("error")).toBe("start");
    expect(overlayAssistantIntent("listening")).toBe("end");
    expect(overlayAssistantIntent("responding")).toBe("end");
    expect(overlayAssistantInterrupt(false, true, "responding")).toBe(false);
    expect(overlayAssistantInterrupt(true, false, "responding")).toBe(true);
    expect(overlayAssistantInterrupt(true, true, "listening")).toBe(true);
    expect(overlayAssistantInterrupt(true, false, "listening")).toBe(false);
    expect(overlayDictateIntent("listening")).toBe("stop");
  });

  it("shows listening, responding, and error without using the dictation states", () => {
    expect(overlayAssistantFrom("IDLE")).toBe("idle");
    expect(overlayAssistantFrom("CONNECTING")).toBe("listening");
    expect(overlayAssistantFrom("READY")).toBe("listening");
    expect(overlayAssistantFrom("RESPONDING")).toBe("responding");
    expect(overlayAssistantFrom("ERROR")).toBe("error");
    expect(overlayAssistantFrom("RESPONDING")).not.toBe(overlayDictationFrom("LISTENING"));
  });

  it("keeps the hidden WebView awake while Assistant is listening or speaking", () => {
    expect(overlayKeepsWebViewAwake("idle", "idle")).toBe(false);
    expect(overlayKeepsWebViewAwake("idle", "error")).toBe(false);
    expect(overlayKeepsWebViewAwake("idle", "listening")).toBe(true);
    expect(overlayKeepsWebViewAwake("idle", "responding")).toBe(true);
    expect(overlayKeepsWebViewAwake("listening", "idle")).toBe(true);
  });
});
