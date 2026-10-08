import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContinuation } from "@/assistant/continuation";
import { AssistantController, type AssistantSessionHandle } from "@/assistant/AssistantController";
import { assistantCueTransition, bindAssistantCues } from "@/assistant/assistantCues";
import type { AssistantEvent } from "@/assistant/events";
import type { AudioCapture } from "@/voice/audio/AudioCapture";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";

class FakeSession implements AssistantSessionHandle {
  static opened: FakeSession[] = [];
  turns: string[] = [];
  notes: string[] = [];
  frames: string[] = [];
  selections: Array<string | null> = [];
  accounts: Array<string | null> = [];
  personals: Array<string | null> = [];
  histories: Array<Array<{ role: string; text: string }>> = [];
  audio: ArrayBuffer[] = [];
  closed = false;

  constructor(private onEvent: (event: AssistantEvent) => void) {
    FakeSession.opened.push(this);
  }

  connect() {
    this.onEvent({ type: "ready" });
    return Promise.resolve();
  }

  sendTurn(text: string, selectionText?: string | null, accountText?: string | null, personalText?: string | null) {
    this.turns.push(text);
    this.selections.push(selectionText ?? null);
    this.accounts.push(accountText ?? null);
    this.personals.push(personalText ?? null);
  }
  sendHistory(turns: { role: "user" | "model"; text: string }[]) { this.histories.push(turns); }
  sendNote(text: string) { this.notes.push(text); }
  sendVideo(jpegBase64: string) { this.frames.push(jpegBase64); }
  responses: unknown[] = [];
  sendToolResponse(message: unknown) { this.responses.push(message); }
  sendAudio(pcm: ArrayBuffer) { this.audio.push(pcm); }
  close() { this.closed = true; }
  emit(event: AssistantEvent) { this.onEvent(event); }
}

class FakePlayback {
  chunks: ArrayBuffer[] = [];
  cleared = 0;
  prime() {}
  enqueue(pcm: ArrayBuffer) { this.chunks.push(pcm); }
  clear() { this.cleared += 1; this.chunks = []; }
}

function controller() {
  const playback = new FakePlayback();
  let next = 0;
  const created = new AssistantController(
    (onEvent) => new FakeSession(onEvent),
    playback,
    () => `id-${next += 1}`,
  );
  return { created, playback };
}

afterEach(() => { FakeSession.opened = []; vi.useRealTimers(); });

describe("AssistantController", () => {
  it("plays the same ready/done cues when Assistant starts and stops, honoring the existing sound preference", () => {
    const { created } = controller();
    const playDictationCue = vi.fn().mockResolvedValue(undefined);
    let enabled = true;
    const unbind = bindAssistantCues(created, { playDictationCue }, () => enabled);

    created.start();
    expect(playDictationCue).toHaveBeenCalledTimes(1);
    expect(playDictationCue).toHaveBeenCalledWith("ready");
    created.send("Hello");
    (FakeSession.opened[0] as FakeSession).emit({ type: "outputTranscription", text: "Hi!" });
    (FakeSession.opened[0] as FakeSession).emit({ type: "turnComplete" });
    expect(playDictationCue).toHaveBeenCalledTimes(1);
    created.end();
    expect(playDictationCue).toHaveBeenNthCalledWith(2, "done");
    created.end();
    expect(playDictationCue).toHaveBeenCalledTimes(2);

    enabled = false;
    created.start();
    created.end();
    expect(playDictationCue).toHaveBeenCalledTimes(2);
    enabled = true;
    created.start();
    expect(playDictationCue).toHaveBeenNthCalledWith(3, "ready");
    unbind();
    created.end();
    expect(playDictationCue).toHaveBeenCalledTimes(3);
  });

  it("ignores audio playback errors without interrupting Assistant", async () => {
    const { created } = controller();
    const playDictationCue = vi.fn().mockRejectedValue(new Error("No output device"));
    const unbind = bindAssistantCues(created, { playDictationCue }, () => true);
    created.start();
    expect(created.getSnapshot().status).toBe("READY");
    created.end();
    await Promise.resolve();
    expect(created.getSnapshot().status).toBe("IDLE");
    expect(playDictationCue).toHaveBeenCalledTimes(2);
    unbind();
  });

  it("never replays the ready cue on reconnect or during Assistant replies", () => {
    const idle = { status: "IDLE" as const, resuming: false };
    const connecting = { status: "CONNECTING" as const, resuming: false };
    const ready = { status: "READY" as const, resuming: false };
    const responding = { status: "RESPONDING" as const, resuming: false };
    const reconnecting = { status: "CONNECTING" as const, resuming: true };
    expect(assistantCueTransition(idle, connecting, false)).toEqual({ cue: null, readySeen: false });
    expect(assistantCueTransition(connecting, ready, false)).toEqual({ cue: "ready", readySeen: true });
    expect(assistantCueTransition(ready, responding, true).cue).toBeNull();
    expect(assistantCueTransition(responding, ready, true).cue).toBeNull();
    expect(assistantCueTransition(ready, reconnecting, true).cue).toBeNull();
    expect(assistantCueTransition(reconnecting, ready, true)).toEqual({ cue: null, readySeen: true });
    expect(assistantCueTransition(ready, idle, true)).toEqual({ cue: "done", readySeen: false });
    expect(assistantCueTransition({ status: "ERROR", resuming: false }, idle, false).cue).toBeNull();
  });

  it("lets the Assistant retrieve earlier transcripts without modifying them", async () => {
    const { created } = controller();
    const actions = toolActions();
    created.setActions(actions);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    const id = "33333333-3333-4333-8333-333333333333";
    session.emit({ type: "toolCalls", calls: [
      { id: "history-list", name: "list_past_conversations", args: { query: "earlier" } },
      { id: "history-read", name: "read_past_conversation", args: { conversation_id: id } },
    ] });
    await vi.waitFor(() => expect(actions.readPastConversation).toHaveBeenCalledWith(id));
    expect(actions.listPastConversations).toHaveBeenCalledWith("earlier", null);
    expect(session.responses).toHaveLength(2);
    expect(JSON.stringify(session.responses)).toContain("Earlier talk");
    created.end();
  });

  it("plays a reply, returns to ready, and sends a second turn on the same session", () => {
    const { created, playback } = controller();
    created.start();
    expect(created.getSnapshot().status).toBe("READY");
    created.send("Reply with exactly: Assistant online.");
    const session = FakeSession.opened[0] as FakeSession;
    const pcm = Uint8Array.of(0, 0).buffer;
    session.emit({ type: "audio", pcm });
    session.emit({ type: "outputTranscription", text: "Assistant" });
    session.emit({ type: "outputTranscription", text: " online." });
    session.emit({ type: "turnComplete" });

    expect(created.getSnapshot().status).toBe("READY");
    expect(created.getSnapshot().turns.map((turn) => turn.text)).toEqual([
      "Reply with exactly: Assistant online.",
      "Assistant online.",
    ]);
    expect(playback.chunks).toEqual([pcm]);

    created.send("  What exact phrase did I ask you to say?  ");
    expect(FakeSession.opened).toHaveLength(1);
    expect(session.closed).toBe(false);
    expect(session.turns).toEqual([
      "Reply with exactly: Assistant online.",
      "What exact phrase did I ask you to say?",
    ]);
    expect(created.getSnapshot().status).toBe("RESPONDING");
  });

  it("stops audio on end and drops a reply that arrives afterward", () => {
    const { created, playback } = controller();
    created.start();
    created.send("Hello");
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "outputTranscription", text: "partial" });
    session.emit({ type: "audio", pcm: Uint8Array.of(1, 2).buffer });
    created.end();
    session.emit({ type: "outputTranscription", text: "should not appear" });
    session.emit({ type: "turnComplete" });
    session.emit({ type: "audio", pcm: Uint8Array.of(3, 4).buffer });

    const snapshot = created.getSnapshot();
    expect(snapshot.status).toBe("IDLE");
    expect(snapshot.liveText).toBe("");
    expect(snapshot.turns).toEqual([
      { id: "id-1", role: "user", text: "Hello" },
      { id: "id-2", role: "assistant", text: "partial", status: "interrupted" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("should not appear");
    expect(session.closed).toBe(true);
    expect(playback.cleared).toBeGreaterThan(0);
    expect(playback.chunks).toEqual([]);
  });

  it("reports each committed turn once and does not report a reloaded transcript", () => {
    const { created } = controller();
    const seen: string[] = [];
    created.setCommittedTurnHandler((turn) => seen.push(`${turn.id}:${turn.status ?? "final"}:${turn.text}`));
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "inputTranscription", text: "Hello", partial: false });
    session.emit({ type: "outputTranscription", text: "Hi there" });
    created.end();
    expect(seen).toEqual(["id-1:final:Hello", "id-2:interrupted:Hi there"]);
    created.showSaved([{ id: "id-1", role: "user", text: "Hello" }]);
    expect(seen).toEqual(["id-1:final:Hello", "id-2:interrupted:Hi there"]);
    expect(created.getSnapshot().turns).toEqual([{ id: "id-1", role: "user", text: "Hello" }]);
  });

  it("keeps a user line cut off by a refused connection as interrupted", () => {
    const { created } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "inputTranscription", text: "half a sentence", partial: true });
    session.emit({ type: "error", message: "Assistant disconnected (1008: refused).", retryable: false });
    expect(created.getSnapshot().turns).toEqual([
      { id: "id-1", role: "user", text: "half a sentence", status: "interrupted" },
    ]);
  });

  it("ignores the previous session after a new start", () => {
    const { created } = controller();
    created.start();
    const first = FakeSession.opened[0] as FakeSession;
    created.end();
    created.start();
    const second = FakeSession.opened[1] as FakeSession;
    first.emit({ type: "outputTranscription", text: "from the old session" });
    first.emit({ type: "turnComplete" });
    expect(created.getSnapshot().liveText).toBe("");
    expect(created.getSnapshot().status).toBe("READY");
    created.send("again");
    second.emit({ type: "outputTranscription", text: "current" });
    second.emit({ type: "turnComplete" });
    expect(created.getSnapshot().turns.map((turn) => turn.text)).toEqual(["again", "current"]);
  });

  it("fails the turn when Assistant never answers", () => {
    vi.useFakeTimers();
    const { created } = controller();
    created.start();
    created.send("Hello");
    vi.advanceTimersByTime(45_000);
    expect(created.getSnapshot().status).toBe("ERROR");
    expect(created.getSnapshot().error).toBe("Assistant didn't respond. Try again.");
  });

  it("streams microphone chunks on one session across two spoken turns and stops capture on end", () => {
    const playback = new FakePlayback();
    const lease = new MicrophoneLease();
    const mics: FakeMic[] = [];
    let next = 0;
    const created = new AssistantController(
      (onEvent) => new FakeSession(onEvent),
      playback,
      () => `id-${next += 1}`,
      () => {
        const mic = new FakeMic();
        mics.push(mic);
        return mic;
      },
      lease,
    );
    created.start();
    const mic = mics[0] as FakeMic;
    const first = Uint8Array.of(1, 2, 3, 4).buffer;
    const second = Uint8Array.of(5, 6).buffer;
    mic.push(first);
    const session = FakeSession.opened[0] as FakeSession;
    expect(session.audio).toEqual([first]);
    expect(lease.heldBy()).toBe("assistant");

    session.emit({ type: "inputTranscription", text: "forty", partial: true });
    expect(created.getSnapshot().liveUser).toBe("forty");
    session.emit({ type: "inputTranscription", text: "My favorite test number is forty two.", partial: false });
    session.emit({ type: "outputTranscription", text: "Got it." });
    session.emit({ type: "turnComplete" });
    mic.push(second);
    session.emit({ type: "inputTranscription", text: "What test number did I just give you?", partial: false });
    session.emit({ type: "turnComplete" });

    expect(FakeSession.opened).toHaveLength(1);
    expect(mics).toHaveLength(1);
    expect(session.audio).toEqual([first, second]);
    expect(created.getSnapshot().turns.map((turn) => `${turn.role}:${turn.text}`)).toEqual([
      "user:My favorite test number is forty two.",
      "assistant:Got it.",
      "user:What test number did I just give you?",
    ]);

    created.end();
    mic.push(Uint8Array.of(7, 8).buffer);
    expect(mic.stopped).toBe(true);
    expect(session.audio).toHaveLength(2);
    expect(lease.heldBy()).toBeNull();
    expect(playback.cleared).toBeGreaterThan(0);
  });

  it("does not open the microphone while dictation holds it", () => {
    const lease = new MicrophoneLease();
    expect(lease.claim("dictation")).toBe(true);
    const mics: FakeMic[] = [];
    const created = new AssistantController(
      (onEvent) => new FakeSession(onEvent),
      new FakePlayback(),
      () => "id",
      () => {
        const mic = new FakeMic();
        mics.push(mic);
        return mic;
      },
      lease,
    );
    created.start();
    expect(mics).toHaveLength(0);
    expect(FakeSession.opened).toHaveLength(0);
    expect(created.getSnapshot()).toMatchObject({ status: "ERROR", error: "Dictation is using the microphone." });
    expect(lease.heldBy()).toBe("dictation");
  });

  it("stops queued audio on barge-in and drops model output until that turn ends", () => {
    const { created, playback } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    const first = Uint8Array.of(1, 0).buffer;
    const stale = Uint8Array.of(2, 0).buffer;
    const next = Uint8Array.of(3, 0).buffer;
    session.emit({ type: "audio", pcm: first });
    session.emit({ type: "outputTranscription", text: "A very long explanation." });
    session.emit({ type: "interrupted" });
    session.emit({ type: "audio", pcm: stale });
    session.emit({ type: "outputTranscription", text: "more of the old answer" });
    session.emit({ type: "turnComplete" });
    session.emit({ type: "inputTranscription", text: "Stop. Give me the answer in one sentence.", partial: false });
    session.emit({ type: "audio", pcm: next });
    session.emit({ type: "outputTranscription", text: "One sentence." });
    session.emit({ type: "turnComplete" });

    expect(playback.chunks).toEqual([next]);
    expect(playback.cleared).toBeGreaterThan(0);
    expect(created.getSnapshot().status).toBe("READY");
    expect(created.getSnapshot().turns.map((turn) => turn.text)).toEqual([
      "A very long explanation.",
      "Stop. Give me the answer in one sentence.",
      "One sentence.",
    ]);
  });

  it("reconnects with the newest handle and ignores the old socket", () => {
    const handles: Array<string | null> = [];
    const playback = new FakePlayback();
    const mics: FakeMic[] = [];
    const lease = new MicrophoneLease();
    const created = new AssistantController(
      (onEvent, handle) => {
        handles.push(handle ?? null);
        return new FakeSession(onEvent);
      },
      playback,
      () => `id-${handles.length}`,
      () => {
        const mic = new FakeMic();
        mics.push(mic);
        return mic;
      },
      lease,
    );
    created.start();
    const first = FakeSession.opened[0] as FakeSession;
    const mic = mics[0] as FakeMic;
    first.emit({ type: "resumption", handle: "older" });
    first.emit({ type: "resumption", handle: "newest" });
    first.emit({ type: "inputTranscription", text: "The code word is bluebird.", partial: false });
    first.emit({ type: "outputTranscription", text: "Noted." });
    first.emit({ type: "turnComplete" });
    created.reconnect();

    expect(handles).toEqual([null, "newest"]);
    expect(first.closed).toBe(true);
    expect(mic.stopped).toBe(false);
    expect(lease.heldBy()).toBe("assistant");
    expect(created.getSnapshot().status).toBe("READY");
    expect(created.getSnapshot().turns.map((turn) => turn.text)).toEqual([
      "The code word is bluebird.",
      "Noted.",
    ]);
    first.emit({ type: "outputTranscription", text: "from the old socket" });
    expect(created.getSnapshot().liveText).toBe("");
    const second = FakeSession.opened[1] as FakeSession;
    second.emit({ type: "outputTranscription", text: "Still here." });
    second.emit({ type: "turnComplete" });
    expect(created.getSnapshot().turns.at(-1)?.text).toBe("Still here.");
    expect(JSON.stringify(created.getSnapshot())).not.toContain("newest");
  });

  it("keeps microphone audio across the reconnect and sends it on the new socket", () => {
    const opened: GateSession[] = [];
    const mics: FakeMic[] = [];
    const created = new AssistantController(
      (onEvent, handle) => {
        const session = new GateSession(onEvent, handle);
        opened.push(session);
        return session;
      },
      new FakePlayback(),
      () => "id",
      () => {
        const mic = new FakeMic();
        mics.push(mic);
        return mic;
      },
    );
    created.start();
    const first = opened[0] as GateSession;
    first.markReady();
    first.emit({ type: "resumption", handle: "newest" });
    created.reconnect();
    const micChunk = Uint8Array.of(9, 0).buffer;
    mics[0]?.push(micChunk);
    expect(opened[1]?.audio).toEqual([]);
    opened[1]?.markReady();
    expect(opened[1]?.handle).toBe("newest");
    expect(opened[1]?.audio).toEqual([micChunk]);
    expect(first.closed).toBe(true);
    expect(mics).toHaveLength(1);
    expect(mics[0]?.stopped).toBe(false);
  });

  it("fails a GoAway with no handle instead of pretending the conversation survived", () => {
    const { created, playback } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "goAway" });
    expect(created.getSnapshot()).toMatchObject({
      status: "ERROR",
      error: "Assistant disconnected and the conversation could not be resumed.",
    });
    expect(FakeSession.opened).toHaveLength(1);
    expect(playback.cleared).toBeGreaterThan(0);
    expect(session.closed).toBe(true);
  });

  it("does not resume a refused close, and stops after one failed reconnect", () => {
    const { created } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "resumption", handle: "newest" });
    session.emit({ type: "error", message: "Assistant disconnected (1008: refused).", retryable: false });
    expect(FakeSession.opened).toHaveLength(1);
    expect(created.getSnapshot().error).toBe("Assistant disconnected (1008: refused).");

    const handles: Array<string | null> = [];
    const again = new AssistantController(
      (onEvent, handle) => {
        handles.push(handle ?? null);
        return handles.length === 1 ? new FakeSession(onEvent) : new DropSession(onEvent);
      },
      new FakePlayback(),
      () => "id",
    );
    again.start();
    (FakeSession.opened.at(-1) as FakeSession).emit({ type: "resumption", handle: "newest" });
    again.reconnect();
    expect(again.getSnapshot()).toMatchObject({
      status: "ERROR",
      error: "Assistant couldn't resume the conversation.",
    });
    expect(handles).toEqual([null, "newest"]);
  });

  it("attaches only an explicit selection, then drops it on remove and end", () => {
    const { created } = controller();
    created.start();
    expect(created.getSnapshot().selection).toBeNull();
    const item = {
      type: "selection" as const,
      text: "Persyn are a application that help create content.",
      sourceApp: "Notes",
      capturedAt: "2026-09-28T00:00:00.000Z",
    };
    expect(created.attachSelection(item)).toBeNull();
    const session = FakeSession.opened[0] as FakeSession;
    expect(session.notes[0]).toContain("Source app: Notes");
    expect(session.notes[0]).toContain(item.text);
    created.send("Rewrite the selected sentence so the grammar is correct.");
    expect(session.turns).toEqual(["Rewrite the selected sentence so the grammar is correct."]);
    expect(session.selections[0]).toContain(item.text);
    expect(session.selections[0]).not.toContain("Rewrite the selected sentence");
    session.emit({ type: "turnComplete" });
    created.detachSelection();
    expect(created.getSnapshot().selection).toBeNull();
    expect(session.notes.at(-1)).toContain("not active context");
    created.send("What was the selected sentence?");
    expect(session.selections.at(-1)).toBeNull();

    created.attachSelection(item);
    created.end();
    expect(created.getSnapshot().selection).toBeNull();
    created.start();
    created.send("Again?");
    const next = FakeSession.opened.at(-1) as FakeSession;
    expect(next.selections.at(-1)).toBeNull();
    expect(next.notes).toEqual([]);
  });

  it("refuses an oversized selection without attaching it", () => {
    const { created } = controller();
    const message = created.attachSelection({
      type: "selection",
      text: "x".repeat(8_001),
      capturedAt: "2026-09-28T00:00:00.000Z",
    });
    expect(message).toMatch(/8,?000/);
    expect(created.getSnapshot().selection).toBeNull();
    expect(created.getSnapshot().selectionError).toBe(message);
  });

  it("ends the live assistant session through a voice tool call", async () => {
    vi.useFakeTimers();
    const { created } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [
      { id: "end-1", name: "end_assistant_session", args: {} },
    ] });
    await vi.advanceTimersByTimeAsync(150);
    expect(created.getSnapshot().status).toBe("IDLE");
    expect(session.closed).toBe(true);
  });

  it("requires explicit confirmation to paste a camera photo even in auto-run", async () => {
    const { created } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [
      { id: "photo-1", name: "paste_camera_photo", args: { window: "ChatGPT - Google Chrome" } },
    ] });
    await settle();
    expect(created.getSnapshot().pendingAction?.title).toMatch(/camera photo/i);
    created.cancelPending();
    expect(created.getSnapshot().pendingAction).toBeNull();
  });

  it("retrieves personal memory by tool without granting action permissions", async () => {
    const { created } = controller();
    const actions = toolActions();
    created.setActions(actions);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [
      { id: "mem-srch", name: "search_memory", args: { query: "voice project" } },
    ] });
    await settle();
    expect(actions.searchMemory).toHaveBeenCalledWith("voice project");
    expect(JSON.stringify(session.responses)).toContain("Search evidence for voice project");
    expect(actions.rememberMemory).not.toHaveBeenCalled();
  });

  it("copies without confirmation and returns the same function id", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "call-1", name: "copy_text", args: { text: "copied by assistant", extra: true } }],
    });
    await settle();
    expect(used.copyText).toHaveBeenCalledWith("copied by assistant");
    expect(used.insertText).not.toHaveBeenCalled();
    expect(created.getSnapshot().pendingAction).toBeNull();
    expect(created.getSnapshot().actionNotice).toBe("Copied to the clipboard.");
    expect(session.responses).toEqual([{
      toolResponse: {
        functionResponses: [{ id: "call-1", name: "copy_text", response: { result: "Copied to the clipboard." } }],
      },
    }]);
  });

  it("runs local tools even when the transcript lease belongs to another device", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setActions(used);
    created.setProducer(() => false);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "call-1", name: "copy_text", args: { text: "copied by assistant" } }],
    });
    await settle();
    expect(used.copyText).toHaveBeenCalledWith("copied by assistant");
    expect(created.getSnapshot().actionNotice).toBe("Copied to the clipboard.");
  });

  it("captures the screen when asked and reports a capture failure", async () => {
    const { created } = controller();
    const used = toolActions();
    used.captureScreen.mockResolvedValueOnce({
      source: "screen",
      capturedAt: "2026-09-28T12:00:00.000Z",
      jpeg: "/9j/shot",
      width: 10,
      height: 8,
    });
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [{ id: "shot", name: "capture_screen", args: {} }] });
    await settle();
    expect(used.captureScreen).toHaveBeenCalled();
    expect(created.getSnapshot().screen?.jpeg).toBe("/9j/shot");
    expect(session.frames).toEqual(["/9j/shot"]);
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "shot", name: "capture_screen", response: { result: "Captured the screen." } }] },
    });
    used.captureScreen.mockRejectedValueOnce(new Error("Couldn't capture the screen."));
    session.emit({ type: "toolCalls", calls: [{ id: "shot-2", name: "capture_screen", args: {} }] });
    await settle();
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "shot-2", response: { error: "Couldn't capture the screen." } }] },
    });
    expect(created.getSnapshot().screen?.jpeg).toBe("/9j/shot");
  });

  it("reads notes and attaches a selection without confirmation", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [{ id: "notes", name: "list_voice_notes", args: {} }] });
    await settle();
    expect(used.listVoiceNotes).toHaveBeenCalledWith(false);
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "notes", response: { result: "Notes (1):\n1. id: n1\nBuy milk" } }] },
    });
    session.emit({ type: "toolCalls", calls: [{ id: "sel", name: "capture_selection", args: {} }] });
    await settle();
    expect(created.getSnapshot().selection?.text).toBe("highlighted line");
    expect(session.notes.at(-1)).toContain("highlighted line");
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "sel", response: { result: expect.stringContaining("highlighted line") } }] },
    });
  });

  it("deletes a note in auto mode without a confirm card", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setActions(used);
    created.setAutoRun(true);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [{ id: "del", name: "delete_voice_note", args: { id: "n1" } }] });
    await settle();
    expect(used.deleteVoiceNote).toHaveBeenCalledWith("n1");
    expect(created.getSnapshot().pendingAction).toBeNull();
  });

  it("waits to delete a note until the user confirms", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setAutoRun(false);
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "toolCalls", calls: [{ id: "del", name: "delete_voice_note", args: { id: "n1" } }] });
    await settle();
    expect(used.deleteVoiceNote).not.toHaveBeenCalled();
    expect(created.getSnapshot().pendingAction?.title).toBe("Delete this note");
    expect(created.getSnapshot().pendingAction?.preview).toBe("Preview n1");
    created.confirmPending();
    await settle();
    expect(used.deleteVoiceNote).toHaveBeenCalledWith("n1");
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "del", response: { result: "Deleted the note." } }] },
    });
  });

  it("reads another device without a modifying action", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "call-remote", name: "read_remote_device", args: { kind: "active_window", device: "Desk PC" } }],
    });
    await settle();
    expect(used.readRemote).toHaveBeenCalledWith("active_window", "Desk PC");
    expect(used.insertText).not.toHaveBeenCalled();
    expect(used.sendHandoff).not.toHaveBeenCalled();
    expect(session.responses).toEqual([{
      toolResponse: {
        functionResponses: [{ id: "call-remote", name: "read_remote_device", response: { result: "Desk PC is online (windows)." } }],
      },
    }]);
  });

  it("confirms insert, cancels without calling it, and reports a service failure", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setAutoRun(false);
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "insert-1", name: "insert_text", args: { text: "Hello" } }],
    });
    await settle();
    expect(created.getSnapshot().pendingAction).toMatchObject({
      title: "Insert this text into the focused app",
      working: false,
    });
    expect(used.insertText).not.toHaveBeenCalled();
    created.cancelPending();
    expect(used.insertText).not.toHaveBeenCalled();
    expect(session.responses.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [{
          id: "insert-1",
          name: "insert_text",
          response: { error: "The user cancelled. Nothing was changed." },
        }],
      },
    });

    used.createVoiceNote.mockRejectedValue(new Error("Saving the note failed."));
    session.emit({
      type: "toolCalls",
      calls: [{ id: "note-1", name: "create_voice_note", args: { text: "Assistant tool test." } }],
    });
    await settle();
    created.confirmPending();
    await settle();
    expect(used.createVoiceNote).toHaveBeenCalledWith("Assistant tool test.");
    expect(JSON.stringify(session.responses.at(-1))).not.toContain("Saved the note.");
    expect(session.responses.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [{
          id: "note-1",
          name: "create_voice_note",
          response: { error: "Saving the note failed." },
        }],
      },
    });
  });

  it("sends a handoff only after confirm and ignores a malformed call", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setAutoRun(false);
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [
        { id: null, name: "copy_text", args: { text: "hidden" } },
        { id: "bad", name: "replace_selection", args: { text: "nope" } },
        { id: "send-1", name: "send_handoff", args: { text: "On the desktop", device: "Desktop" } },
        { id: "send-2", name: "send_handoff", args: { text: "Also this" } },
      ],
    });
    await settle();
    expect(used.copyText).not.toHaveBeenCalled();
    expect(used.sendHandoff).not.toHaveBeenCalled();
    expect(created.getSnapshot().pendingAction?.title).toBe("Send this text to Desktop");
    expect(session.responses[0]).toMatchObject({
      toolResponse: { functionResponses: [{ id: "bad", response: { error: "That action is not available." } }] },
    });
    expect(session.responses[1]).toMatchObject({
      toolResponse: { functionResponses: [{ id: "send-2", response: { error: "Another action is already waiting for confirmation." } }] },
    });
    created.confirmPending();
    await settle();
    expect(used.sendHandoff).toHaveBeenCalledTimes(1);
    expect(used.sendHandoff).toHaveBeenCalledWith("On the desktop", "desk");
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "send-1", response: { result: "Sent the text to Desktop." } }] },
    });
  });

  it("drops a pending insert on end without performing it", async () => {
    const { created } = controller();
    const used = toolActions();
    created.setAutoRun(false);
    created.setActions(used);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "insert-2", name: "insert_text", args: { text: "Do not insert" } }],
    });
    await settle();
    created.end();
    created.confirmPending();
    await settle();
    expect(used.insertText).not.toHaveBeenCalled();
    expect(created.getSnapshot().pendingAction).toBeNull();
    expect(session.responses).toEqual([]);
  });

  it("shows sources only for a grounded reply", () => {
    const { created } = controller();
    created.start();
    created.send("What is 12 times 8?");
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({ type: "outputTranscription", text: "96" });
    session.emit({ type: "turnComplete" });
    expect(created.getSnapshot().turns.at(-1)).toEqual({ id: "id-2", role: "assistant", text: "96" });
    expect(created.getSnapshot().turns.at(-1)).not.toHaveProperty("sources");

    created.send("What is the latest stable Gemini Live model?");
    session.emit({
      type: "grounding",
      sources: [{ title: "Gemini models", url: "https://ai.google.dev/gemini-api/docs/models" }],
    });
    session.emit({ type: "outputTranscription", text: "Gemini 3.8 Live." });
    expect(created.getSnapshot().liveSources).toEqual([
      { title: "Gemini models", url: "https://ai.google.dev/gemini-api/docs/models" },
    ]);
    session.emit({ type: "turnComplete" });
    expect(created.getSnapshot().liveSources).toEqual([]);
    expect(created.getSnapshot().turns.at(-1)).toMatchObject({
      role: "assistant",
      text: "Gemini 3.8 Live.",
      sources: [{ title: "Gemini models", url: "https://ai.google.dev/gemini-api/docs/models" }],
    });
    expect(created.getSnapshot().turns[1]).not.toHaveProperty("sources");
  });

  it("sends one screenshot, replaces it, and removes it without another frame", () => {
    const { created } = controller();
    const first = { source: "window" as const, sourceApp: "Notes", capturedAt: "t1", jpeg: "frame-a", width: 8, height: 8 };
    const second = { source: "screen" as const, capturedAt: "t2", jpeg: "frame-b", width: 8, height: 8 };
    created.attachSnapshot(first);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    expect(created.getSnapshot().screen?.jpeg).toBe("frame-a");
    expect(session.frames).toEqual(["frame-a"]);
    expect(session.notes[0]).toContain("Notes");

    created.attachSnapshot(second);
    expect(session.frames).toEqual(["frame-a", "frame-b"]);
    expect(created.getSnapshot().screen?.source).toBe("screen");

    created.send("Describe this screenshot.");
    expect(session.frames).toEqual(["frame-a", "frame-b"]);
    expect(session.turns).toEqual(["Describe this screenshot."]);

    created.detachSnapshot();
    expect(created.getSnapshot().screen).toBeNull();
    expect(session.frames).toHaveLength(2);
    expect(session.notes.at(-1)).toContain("removed");

    created.attachSnapshot(first);
    created.end();
    expect(created.getSnapshot().status).toBe("IDLE");
    expect(created.getSnapshot().screen).toBeNull();
  });

  it("records a refused capture without attaching a screenshot", () => {
    const { created } = controller();
    created.attachSnapshot({ source: "screen", capturedAt: "t", jpeg: "kept", width: 1, height: 1 });
    created.reportSnapshotError("Screen capture was cancelled.");
    expect(created.getSnapshot().screen?.jpeg).toBe("kept");
    expect(created.getSnapshot().screenError).toBe("Screen capture was cancelled.");
    created.end();
  });

  it("keeps the same screenshot across later questions until an explicit recapture", () => {
    const { created } = controller();
    const shot = { source: "window" as const, sourceApp: "Editor", capturedAt: "t1", jpeg: "frame-a", width: 8, height: 8 };
    created.attachSnapshot(shot);
    created.attachSelection({
      type: "selection",
      text: "line 12: cannot find name",
      sourceApp: "Editor",
      capturedAt: "t1",
    });
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    expect(session.frames).toEqual(["frame-a"]);
    expect(created.getSnapshot().screen?.jpeg).toBe("frame-a");
    expect(created.getSnapshot().selection?.text).toContain("line 12");

    created.send("Why is this error happening?");
    session.emit({ type: "turnComplete" });
    created.send("Which line should I change?");
    session.emit({ type: "turnComplete" });
    created.send("look again");
    expect(session.frames).toEqual(["frame-a"]);
    expect(created.getSnapshot().screen).toMatchObject({ jpeg: "frame-a", capturedAt: "t1" });
    expect(session.turns).toEqual([
      "Why is this error happening?",
      "Which line should I change?",
      "look again",
    ]);
    expect(session.selections.every((part) => part?.includes("line 12"))).toBe(true);

    created.attachSnapshot({ ...shot, jpeg: "frame-b", capturedAt: "t2" });
    expect(session.frames).toEqual(["frame-a", "frame-b"]);
    session.emit({ type: "turnComplete" });
    created.send("What does the warning below it mean?");
    expect(session.frames).toEqual(["frame-a", "frame-b"]);
    expect(created.getSnapshot().screen?.jpeg).toBe("frame-b");

    created.end();
    expect(created.getSnapshot().status).toBe("IDLE");
    expect(created.getSnapshot().screen).toBeNull();
    expect(created.getSnapshot().selection).toBeNull();
  });

  it("uses attached notes and one handoff without changing the source items", () => {
    const { created } = controller();
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    const amber = { id: "a", text: "The launch code is amber.", createdAt: "2026-09-28T00:00:00.000Z" };
    const blue = { id: "b", text: "The backup code is blue.", createdAt: "2026-09-28T00:01:00.000Z" };
    Object.freeze(amber);
    expect(created.attachNote(amber)).toBeNull();
    expect(created.attachNote(blue)).toBeNull();
    expect(created.attachNote(amber)).toContain("already attached");
    const handoff = { id: "h", text: "Meet at the dock.", createdAt: "2026-09-28T01:00:00.000Z", sourceLabel: "Phone" };
    Object.freeze(handoff);
    expect(created.attachHandoff(handoff)).toBeNull();
    expect(amber.text).toBe("The launch code is amber.");
    expect(handoff.text).toBe("Meet at the dock.");

    created.send("Summarize the two attached notes and tell me how they differ.");
    expect(session.accounts[0]).toContain("amber");
    expect(session.accounts[0]).toContain("blue");
    expect(session.accounts[0]).toContain("dock");
    expect(session.turns[0]).not.toContain("amber");

    session.emit({ type: "turnComplete" });
    created.detachNote("a");
    created.send("What was the launch code?");
    expect(session.accounts[1]).not.toContain("amber");
    expect(session.accounts[1]).toContain("blue");
    expect(session.notes.some((note) => note.includes("not active context"))).toBe(true);

    session.emit({ type: "turnComplete" });
    created.end();
    expect(created.getSnapshot().notes).toEqual([]);
    expect(created.getSnapshot().handoff).toBeNull();
  });

  it("clears idle attachments on sign-out and keeps them after a failure", () => {
    const idle = new AssistantController((onEvent) => new FakeSession(onEvent), new FakePlayback());
    const note = { id: "a", text: "Offline fact.", createdAt: "2026-09-28T00:00:00.000Z" };
    expect(idle.attachNote(note)).toBeNull();
    expect(idle.attachSelection({
      type: "selection",
      text: "Account A secret.",
      capturedAt: "2026-09-28T00:00:00.000Z",
    })).toBeNull();
    idle.setSavedHistory([{ role: "user", text: "The old thread says pineapple." }]);
    expect(idle.getSnapshot().status).toBe("IDLE");
    idle.clearAccountContext();
    expect(idle.getSnapshot().notes).toEqual([]);
    expect(idle.getSnapshot().selection).toBeNull();
    idle.start();
    expect((FakeSession.opened.at(-1) as FakeSession).histories).toEqual([]);
    expect(JSON.stringify((FakeSession.opened.at(-1) as FakeSession).accounts)).not.toContain("Account A secret.");
    idle.end();

    const { created } = controller();
    created.start();
    const kept = { id: "kept", text: "Still here.", createdAt: "2026-09-28T00:00:00.000Z" };
    expect(created.attachNote(kept)).toBeNull();
    (FakeSession.opened.at(-1) as FakeSession).emit({
      type: "error",
      message: "Assistant disconnected.",
      retryable: false,
    });
    expect(created.getSnapshot().notes.map((item) => item.id)).toEqual(["kept"]);
  });

  it("reconstructs a continuation on a new session without a resumption handle", () => {
    const handles: Array<string | null> = [];
    let next = 0;
    const created = new AssistantController(
      (onEvent, handle) => {
        handles.push(handle);
        return new FakeSession(onEvent);
      },
      new FakePlayback(),
      () => `id-${next += 1}`,
    );
    const built = buildContinuation({
      turns: [
        { role: "user", text: "The cross-device code word is pineapple seven." },
        { role: "assistant", text: "Noted." },
      ],
      selection: null,
      notes: [{ id: "n", text: "Desk fact.", createdAt: "2026-09-28T00:00:00.000Z" }],
      handoff: null,
      screen: { source: "window", sourceApp: "Notes", capturedAt: "2026-09-28T01:00:00.000Z" },
      sourceDeviceId: "phone",
      sourceDeviceName: "Phone",
      createdAt: "2026-09-28T02:00:00.000Z",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(created.openContinuation(built.payload)).toBeNull();
    expect(handles).toEqual([null]);
    expect(created.getSnapshot().continuedFrom).toBe("Phone");
    expect(created.getSnapshot().screen).toBeNull();
    expect(created.getSnapshot().turns.map((turn) => turn.text)[0]).toContain("pineapple seven");
    const session = FakeSession.opened.at(-1) as FakeSession;
    expect(session.histories).toHaveLength(1);
    expect(session.histories[0]?.map((turn) => turn.role)).toEqual(["user", "model", "user"]);
    expect(session.histories[0]?.[0]?.text).toContain("pineapple seven");
    expect(session.histories[0]?.[2]?.text).toContain("not transferred");
    expect(JSON.stringify(session.histories)).not.toContain("resume");
    created.send("What was the cross-device code word?");
    expect(session.histories).toHaveLength(1);
    expect(session.turns).toEqual(["What was the cross-device code word?"]);
    expect(session.accounts[0]).toContain("Desk fact.");
  });

  it("seeds saved history once and skips it when the socket resumes", () => {
    const { created } = controller();
    created.setSavedHistory([
      { role: "user", text: "Meet on Friday." },
      { role: "model", text: "Friday is set." },
    ]);
    created.start();
    const first = FakeSession.opened[0] as FakeSession;
    expect(first.histories).toHaveLength(1);
    expect(first.histories[0]?.map((turn) => turn.text).join(" ")).toContain("Meet on Friday.");
    expect(created.getSnapshot().turns.map((turn) => turn.text)).not.toContain("Meet on Friday.");
    first.emit({ type: "resumption", handle: "resume-1" });
    first.emit({ type: "goAway" });
    expect(FakeSession.opened).toHaveLength(2);
    expect((FakeSession.opened[1] as FakeSession).histories).toEqual([]);
    expect(first.histories).toHaveLength(1);
  });

  it("sends a remembered preference once and restarts when it is forgotten", () => {
    const handles: Array<string | null> = [];
    let next = 0;
    const created = new AssistantController(
      (onEvent, handle) => {
        handles.push(handle ?? null);
        return new FakeSession(onEvent);
      },
      new FakePlayback(),
      () => `id-${next += 1}`,
    );
    const preference = {
      id: "00000000-0000-4000-8000-000000000010",
      kind: "preference" as const,
      key: "answer_length",
      value: "Prefer short answers.",
      scope: "account" as const,
      status: "active" as const,
      origin: "explicit" as const,
      sourceConversationId: null,
      sourceMessageId: null,
      supersedesId: null,
      revision: 1,
      createdAt: "2026-09-30T12:00:00.000Z",
      updatedAt: "2026-09-30T12:00:00.000Z",
      forgottenAt: null,
    };
    created.setMemories([preference]);
    created.start();
    const first = FakeSession.opened[0] as FakeSession;
    expect(first.notes.some((note) => note.includes("Prefer short answers."))).toBe(true);
    expect(first.notes.filter((note) => note.includes("Prefer short answers."))).toHaveLength(1);
    first.emit({ type: "resumption", handle: "resume-1" });
    first.emit({ type: "goAway" });
    expect(handles[1]).toBe("resume-1");
    expect((FakeSession.opened[1] as FakeSession).notes.some((note) => note.includes("Prefer short answers."))).toBe(false);
    created.setMemories([]);
    expect(handles.at(-1)).toBeNull();
    const restarted = FakeSession.opened.at(-1) as FakeSession;
    expect(restarted.notes.some((note) => note.includes("Prefer short answers."))).toBe(false);
    expect(created.getSnapshot().actionNotice).toMatch(/restarting/);
  });

  it("sends profile facts, then stops sending them when the profile is turned off", () => {
    const { created } = controller();
    created.setPersonalContext("Desk PC accounts for 72% of dictations this month (18 of 25).");
    created.start();
    const session = FakeSession.opened[0];
    expect(session?.notes.some((note) => note.includes("72%"))).toBe(true);
    created.send("Which device do I use the most?");
    expect(session?.personals[0]).toContain("72%");
    session?.emit({ type: "turnComplete" });
    created.setPersonalContext("Analytics profile is turned off. Do not claim dictation shares, triggers, target apps, dictionary terms, or words per minute.");
    expect(session?.notes.some((note) => note.includes("turned off"))).toBe(true);
    created.send("Which device do I use the most?");
    expect(session?.personals[1]).not.toContain("72%");
    expect(session?.personals[1]).toContain("turned off");
  });

  it("confirms an allowlisted app, reports the real result, and does not open after cancel", async () => {
    const { created } = controller();
    const actions = toolActions();
    created.setAutoRun(false);
    created.setActions(actions);
    created.start();
    const session = FakeSession.opened[0];
    session?.emit({ type: "toolCalls", calls: [{ id: "app", name: "open_app", args: { app: "notepad" } }] });
    await settle();
    expect(actions.computer.openApp).not.toHaveBeenCalled();
    expect(created.getSnapshot().pendingAction?.title).toBe("Open Notepad");
    created.cancelPending();
    await settle();
    expect(actions.computer.openApp).not.toHaveBeenCalled();
    session?.emit({ type: "toolCalls", calls: [{ id: "shell", name: "run_shell", args: { command: "dir" } }] });
    await settle();
    expect(actions.computer.openApp).not.toHaveBeenCalled();
    session?.emit({ type: "toolCalls", calls: [{ id: "app2", name: "open_app", args: { app: "notepad" } }] });
    await settle();
    created.confirmPending();
    await settle();
    expect(actions.computer.openApp).toHaveBeenCalledWith("notepad");
  });

  it("stops a supervised screen task before the click runs", async () => {
    const { created } = controller();
    const actions = toolActions();
    let release = (): void => {};
    actions.computer.propose = vi.fn(() => new Promise<unknown>((resolve) => {
      release = () => resolve({ id: "s", steps: [{ type: "function_call", name: "click", arguments: { x: 1, y: 1 } }] });
    }));
    created.setActions(actions);
    created.start();
    const session = FakeSession.opened[0];
    session?.emit({ type: "toolCalls", calls: [{ id: "task", name: "supervise_screen", args: { goal: "Click the harmless button." } }] });
    await settle();
    created.confirmPending();
    await settle();
    expect(created.getSnapshot().computerRunning).toBe(true);
    created.stopComputer();
    release();
    await settle();
    expect(actions.computer.execute).not.toHaveBeenCalled();
    expect(created.getSnapshot().computerRunning).toBe(false);
  });

  it("captures a camera photo, labels it as camera not screen, and clears on end", async () => {
    const { created } = controller();
    const camera = new FakeCamera();
    created.setCamera(camera);
    created.start();
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "cam", name: "capture_camera_photo", args: { camera: "back" } }],
    });
    await settle();
    expect(camera.photoFacing).toBe("back");
    expect(created.getSnapshot().cameraPhoto?.facing).toBe("back");
    expect(created.getSnapshot().screen).toBeNull();
    expect(session.frames.at(-1)).toBe(TINY_CAMERA_JPEG);
    expect(session.notes.some((note) => note.includes("Camera photo") && note.includes("not a screenshot"))).toBe(true);
    expect(session.responses.at(-1)).toMatchObject({
      toolResponse: { functionResponses: [{ id: "cam", response: { result: expect.stringContaining("rear camera") } }] },
    });
    created.end();
    expect(created.getSnapshot().cameraPhoto).toBeNull();
  });

  it("starts and stops Camera Context without a second microphone and cleans up on end", async () => {
    const lease = new MicrophoneLease();
    const mic = new FakeMic();
    const camera = new FakeCamera();
    const playback = new FakePlayback();
    let next = 0;
    const created = new AssistantController(
      (onEvent) => new FakeSession(onEvent),
      playback,
      () => `id-${next += 1}`,
      () => mic,
      lease,
    );
    created.setCamera(camera);
    created.start();
    expect(mic.stopped).toBe(false);
    const session = FakeSession.opened[0] as FakeSession;
    session.emit({
      type: "toolCalls",
      calls: [{ id: "on", name: "start_camera_context", args: { camera: "front" } }],
    });
    await settle();
    expect(created.getSnapshot().cameraContextActive).toBe(true);
    expect(camera.active).toBe(true);
    expect(camera.frameFacing).toBe("front");
    camera.pushFrame();
    expect(session.frames.length).toBeGreaterThanOrEqual(1);
    session.emit({ type: "toolCalls", calls: [{ id: "off", name: "stop_camera_context", args: {} }] });
    await settle();
    expect(created.getSnapshot().cameraContextActive).toBe(false);
    expect(camera.active).toBe(false);
    expect(mic.stopped).toBe(false);
    session.emit({ type: "toolCalls", calls: [{ id: "on2", name: "start_camera_context", args: {} }] });
    await settle();
    created.end();
    expect(camera.active).toBe(false);
    expect(created.getSnapshot().cameraContextActive).toBe(false);
  });

  it("resumes Camera Context after reconnect only while it is still explicitly desired", async () => {
    const { created } = controller();
    const camera = new FakeCamera();
    created.setCamera(camera);
    created.start();
    const first = FakeSession.opened[0] as FakeSession;
    first.emit({ type: "toolCalls", calls: [{ id: "on", name: "start_camera_context", args: {} }] });
    await settle();
    expect(camera.active).toBe(true);
    first.emit({ type: "resumption", handle: "h1" });
    first.emit({ type: "goAway" });
    await settle();
    expect(created.getSnapshot().cameraContextActive).toBe(true);
    expect(camera.active).toBe(true);
    await created.stopCameraContext();
    expect(camera.active).toBe(false);
    const mid = FakeSession.opened.at(-1) as FakeSession;
    mid.emit({ type: "resumption", handle: "h2" });
    mid.emit({ type: "goAway" });
    await settle();
    expect(camera.active).toBe(false);
  });
});

const TINY_CAMERA_JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));

class FakeCamera {
  active = false;
  photoFacing: string | null = null;
  frameFacing: string | null = null;
  private onFrame: ((frame: {
    jpeg: string;
    width: number;
    height: number;
    capturedAt: string;
    facing: "default" | "front" | "back";
  }) => void) | null = null;

  listDevices() {
    return Promise.resolve([{ id: "1", label: "Cam", facing: "back" as const }]);
  }

  capturePhoto(options?: { facing?: "default" | "front" | "back" }) {
    this.photoFacing = options?.facing ?? "default";
    return Promise.resolve({
      jpeg: TINY_CAMERA_JPEG,
      width: 64,
      height: 48,
      capturedAt: "2026-10-03T20:00:00.000Z",
      facing: this.photoFacing as "default" | "front" | "back",
      label: "Test camera",
    });
  }

  startFrames(
    options: { facing?: "default" | "front" | "back" },
    onFrame: (frame: {
      jpeg: string;
      width: number;
      height: number;
      capturedAt: string;
      facing: "default" | "front" | "back";
    }) => void,
  ) {
    this.active = true;
    this.frameFacing = options.facing ?? "default";
    this.onFrame = onFrame;
    return Promise.resolve();
  }

  switchCamera(facing: "default" | "front" | "back") {
    this.frameFacing = facing;
    return Promise.resolve();
  }

  stop() {
    this.active = false;
    this.onFrame = null;
    return Promise.resolve();
  }

  isActive() {
    return this.active;
  }

  activeFacing() {
    return this.active ? (this.frameFacing as "default" | "front" | "back") : null;
  }

  pushFrame() {
    this.onFrame?.({
      jpeg: TINY_CAMERA_JPEG,
      width: 64,
      height: 48,
      capturedAt: "2026-10-03T20:00:01.000Z",
      facing: (this.frameFacing as "default" | "front" | "back") ?? "default",
    });
  }
}

function toolActions() {
  return {
    copyText: vi.fn(async () => {}),
    insertText: vi.fn(async () => {}),
    createVoiceNote: vi.fn(async () => {}),
    editVoiceNote: vi.fn(async () => {}),
    listSnippets: vi.fn(async () => "[]"),
    createSnippet: vi.fn(async () => {}),
    updateSnippet: vi.fn(async () => {}),
    sendRemoteDictation: vi.fn(async () => {}),
    createTransform: vi.fn(async () => {}),
    addDictionaryWord: vi.fn(async () => {}),
    readDashboard: vi.fn(async () => "{}"),
    planHandoff: vi.fn((deviceName: string | null) => {
      if (deviceName && deviceName.toLocaleLowerCase() !== "desktop") {
        throw new Error(`No other device is named ${deviceName}.`);
      }
      return { deviceId: "desk", label: "Desktop" };
    }),
    sendHandoff: vi.fn(async () => {}),
    readRemote: vi.fn(async () => ({ text: "Desk PC is online (windows).", screenshot: null })),
    captureSelection: vi.fn(async () => ({
      type: "selection" as const,
      text: "highlighted line",
      sourceApp: "Notes",
      capturedAt: "2026-09-28T12:00:00.000Z",
    })),
    listVoiceNotes: vi.fn(async () => "Notes (1):\n1. id: n1\nBuy milk"),
    listHandoffs: vi.fn(async () => "Devices you can send to: Phone.\nNo received handoffs."),
    describeItem: vi.fn((_kind: "note" | "handoff", id: string) => `Preview ${id}`),
    archiveVoiceNote: vi.fn(async () => {}),
    deleteVoiceNote: vi.fn(async () => {}),
    dismissHandoff: vi.fn(async () => {}),
    listMemories: vi.fn(async () => "No memories are remembered."),
    searchMemory: vi.fn(async (query: string) => `Search evidence for ${query}`),
    listPastConversations: vi.fn(async () => '{"results":[{"id":"33333333-3333-4333-8333-333333333333","title":"Earlier talk"}]}'),
    readPastConversation: vi.fn(async () => '{"messages":[{"role":"user","text":"Earlier talk"}]}'),
    rememberMemory: vi.fn(async () => "Remembered answer_length: Prefer short answers."),
    changeMemory: vi.fn(async () => "Changed answer_length."),
    forgetMemory: vi.fn(async () => "Forgot answer_length."),
    captureScreen: vi.fn(async () => ({
      source: "screen" as const,
      capturedAt: "2026-09-28T12:00:00.000Z",
      jpeg: "/9j/shot",
      width: 10,
      height: 8,
    })),
    computer: {
      openApp: vi.fn(async (id: string) => `Opened ${id}.`),
      pressShortcut: vi.fn(async () => "Pressed Copy."),
      remoteAction: vi.fn(async () => "The other device opened Notepad."),
      capture: vi.fn(async () => ({ jpeg: "img", width: 10, height: 10 })),
      propose: vi.fn(async (): Promise<unknown> => ({ id: "done", text: "Finished.", steps: [] })),
      execute: vi.fn(async () => "Clicked."),
      restore: vi.fn(async () => {}),
    },
  };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class DropSession extends FakeSession {
  override connect() {
    this.emit({ type: "disconnected" });
    return Promise.resolve();
  }
}

class GateSession extends FakeSession {
  audio: ArrayBuffer[] = [];
  constructor(
    onEvent: (event: AssistantEvent) => void,
    readonly handle: string | null,
  ) {
    super(onEvent);
  }

  override connect() {
    return Promise.resolve();
  }

  override sendAudio(pcm: ArrayBuffer) {
    this.audio.push(pcm);
  }

  markReady() {
    this.emit({ type: "ready" });
  }
}

class FakeMic implements AudioCapture {
  stopped = false;
  private onChunk?: (pcm: ArrayBuffer) => void;

  start(onChunk: (pcm: ArrayBuffer) => void) {
    this.onChunk = onChunk;
    return Promise.resolve();
  }

  stop() {
    this.stopped = true;
    return Promise.resolve();
  }

  push(pcm: ArrayBuffer) {
    this.onChunk?.(pcm);
  }
}
