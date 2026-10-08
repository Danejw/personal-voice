import { describe, expect, it } from "vitest";
import { ASSISTANT_SEARCH_GUIDANCE } from "@/assistant/grounding";
import { assistantFunctionDeclarations as declaredTools } from "@/assistant/tools";
import {
  ASSISTANT_INPUT_MIME,
  ASSISTANT_INPUT_RATE,
  ASSISTANT_MODEL,
  ASSISTANT_PCM_RATE,
  assistantAudioChunk,
  assistantContextNote,
  assistantHistorySeed,
  assistantSetupMessage,
  assistantSnapshotFrame,
  assistantToolResponse,
  assistantUserTurn,
  decodeBase64,
  nextResumeHandle,
  parseAssistantServerMessage,
  redactSecrets,
  takePcm16,
} from "@/assistant/protocol";

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("assistant setup and typed turns", () => {
  it("configures Gemini 3.8 Live for audio plus an output transcript", () => {
    expect(assistantSetupMessage()).toEqual({
      setup: {
        model: `models/${ASSISTANT_MODEL}`,
        generationConfig: { responseModalities: ["AUDIO"] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
        tools: [
          { functionDeclarations: declaredTools() },
          { googleSearch: {} },
        ],
        systemInstruction: { parts: [{ text: ASSISTANT_SEARCH_GUIDANCE }] },
      },
    });
    const setup = JSON.stringify(assistantSetupMessage());
    expect(setup).not.toContain("NON_BLOCKING");
    expect(setup).not.toContain("replace_selection");
    expect(setup).toContain("googleSearch");
    expect(JSON.stringify(assistantSetupMessage(null, { search: false }))).not.toContain("googleSearch");
    expect(setup).not.toContain("always search");
    expect(declaredTools().map((tool) => tool.name)).toEqual([
      "copy_text",
      "insert_text",
      "create_voice_note",
      "list_voice_notes",
      "archive_voice_note",
      "restore_voice_note",
      "delete_voice_note",
      "send_handoff",
      "list_handoffs",
      "dismiss_handoff",
      "capture_screen",
      "capture_camera_photo",
      "start_camera_context",
      "stop_camera_context",
      "inspect_active_app",
    "invoke_accessible_control",
    "list_snippets",
    "create_snippet",
    "update_snippet",
    "send_remote_dictation",
    "edit_voice_note",
    "create_transform",
    "add_dictionary_word",
    "read_usage_analytics",
    "read_insights",
    "capture_selection",
      "read_remote_device",
      "open_app",
      "press_shortcut",
      "supervise_screen",
      "list_memories",
      "remember_memory",
      "change_memory",
      "forget_memory",
      "remote_action",
    ]);
    expect(ASSISTANT_PCM_RATE).toBe(24_000);
    expect(ASSISTANT_INPUT_RATE).toBe(16_000);
  });

  it("sends microphone audio as 16 kHz PCM and keeps automatic voice detection", () => {
    expect(assistantAudioChunk("AQID")).toEqual({
      realtimeInput: { audio: { data: "AQID", mimeType: ASSISTANT_INPUT_MIME } },
    });
    expect(assistantSnapshotFrame("/9j/")).toEqual({
      realtimeInput: { video: { data: "/9j/", mimeType: "image/jpeg" } },
    });
    expect(JSON.stringify(assistantSetupMessage())).not.toContain("activityStart");
    expect(JSON.stringify(assistantSetupMessage())).not.toContain("disabled");
    expect(assistantSetupMessage("resume-handle")).toMatchObject({
      setup: {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: { handle: "resume-handle" },
      },
    });
  });

  it("seeds earlier turns on a new session without asking for a reply", () => {
    expect(assistantHistorySeed([
      { role: "user", text: "The cross-device code word is pineapple seven." },
      { role: "model", text: "Noted." },
    ])).toEqual({
      clientContent: {
        turns: [
          { role: "user", parts: [{ text: "The cross-device code word is pineapple seven." }] },
          { role: "model", parts: [{ text: "Noted." }] },
        ],
        turnComplete: false,
      },
    });
  });

  it("sends a completed user turn as client content on the same session", () => {
    expect(assistantUserTurn("Assistant online.")).toEqual({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: "Assistant online." }] }],
        turnComplete: true,
      },
    });
  });

  it("keeps an attached selection distinct from the instruction", () => {
    expect(assistantUserTurn("Rewrite this.", "Attached selection.\nPersyn are a application.")).toEqual({
      clientContent: {
        turns: [{
          role: "user",
          parts: [
            { text: "Attached selection.\nPersyn are a application." },
            { text: "Rewrite this." },
          ],
        }],
        turnComplete: true,
      },
    });
    expect(assistantContextNote("The attached selection was removed.")).toMatchObject({
      clientContent: { turnComplete: false },
    });
  });

  it("keeps personal context distinct from the instruction", () => {
    expect(assistantUserTurn("Which device?", null, null, "Desk PC accounts for 72% of dictations this month.")).toEqual({
      clientContent: {
        turns: [{
          role: "user",
          parts: [
            { text: "Desk PC accounts for 72% of dictations this month." },
            { text: "Which device?" },
          ],
        }],
        turnComplete: true,
      },
    });
  });
});

describe("parseAssistantServerMessage", () => {
  it("reads audio, then the output transcript, then turn completion", () => {
    const events = parseAssistantServerMessage({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: b64([1, 2]) } },
            { text: "ignore spoken text parts" },
            { inlineData: { mimeType: "image/jpeg", data: b64([9]) } },
          ],
        },
        outputTranscription: { text: "Assistant online." },
        turnComplete: true,
      },
    });
    expect(events).toEqual([
      { type: "audio", base64: b64([1, 2]) },
      { type: "outputTranscription", text: "Assistant online." },
      { type: "turnComplete" },
    ]);
  });

  it("reads an interim user transcript and then the finished one", () => {
    expect(parseAssistantServerMessage({
      serverContent: { interimInputTranscription: { text: "forty" } },
    })).toEqual([{ type: "inputTranscription", text: "forty", partial: true }]);
    expect(parseAssistantServerMessage({
      serverContent: { inputTranscription: { text: "My favorite test number is forty two." } },
    })).toEqual([{ type: "inputTranscription", text: "My favorite test number is forty two.", partial: false }]);
  });

  it("reports setup, interruption, expiry, and tool calls without raw JSON fields leaking through", () => {
    expect(parseAssistantServerMessage({ setupComplete: {} })).toEqual([{ type: "setupComplete" }]);
    expect(parseAssistantServerMessage({ serverContent: { interrupted: true } })).toEqual([{ type: "interrupted" }]);
    expect(parseAssistantServerMessage({ goAway: { timeLeft: "0s" } })).toEqual([{ type: "goAway" }]);
    expect(parseAssistantServerMessage({ toolCall: { functionCalls: [] } })).toEqual([]);
    expect(parseAssistantServerMessage({
      toolCall: {
        functionCalls: [{ id: "call-1", name: "copy_text", args: { text: "copied by assistant" } }],
      },
    })).toEqual([{
      type: "toolCalls",
      calls: [{ id: "call-1", name: "copy_text", args: { text: "copied by assistant" } }],
    }]);
    expect(assistantToolResponse([{ id: "call-1", name: "copy_text", ok: true, message: "Copied to the clipboard." }])).toEqual({
      toolResponse: {
        functionResponses: [{ id: "call-1", name: "copy_text", response: { result: "Copied to the clipboard." } }],
      },
    });
    expect(assistantToolResponse([{ id: "call-1", name: "insert_text", ok: false, message: "The user cancelled. Nothing was changed." }]).toolResponse.functionResponses[0]?.response).toEqual({
      error: "The user cancelled. Nothing was changed.",
    });
    expect(parseAssistantServerMessage({ usageMetadata: { promptTokenCount: 1 } })).toEqual([]);
  });

  it("keeps web citations and does not mark an ordinary turn as sourced", () => {
    expect(parseAssistantServerMessage({
      serverContent: {
        outputTranscription: { text: "96" },
        turnComplete: true,
      },
    })).toEqual([
      { type: "outputTranscription", text: "96" },
      { type: "turnComplete" },
    ]);
    const parsed = parseAssistantServerMessage({
      serverContent: {
        outputTranscription: { text: "Gemini 3.8 Live is current." },
        groundingMetadata: {
          searchEntryPoint: { renderedContent: "<div>widget</div>" },
          webSearchQueries: ["latest gemini live model"],
          groundingChunks: [
            { web: { uri: "https://ai.google.dev/gemini-api/docs/models", title: "Gemini models" } },
            { web: { uri: "javascript:alert(1)", title: "bad" } },
            { web: { uri: "https://ai.google.dev/gemini-api/docs/models", title: "duplicate" } },
          ],
        },
        turnComplete: true,
      },
    });
    expect(parsed).toEqual([
      { type: "outputTranscription", text: "Gemini 3.8 Live is current." },
      {
        type: "grounding",
        sources: [{ title: "Gemini models", url: "https://ai.google.dev/gemini-api/docs/models" }],
      },
      { type: "turnComplete" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("widget");
    expect(JSON.stringify(parsed)).not.toContain("webSearchQueries");
    expect(ASSISTANT_SEARCH_GUIDANCE).toContain("Do not search");
  });

  it("keeps only a resumable handle and ignores one that would drop context", () => {
    expect(parseAssistantServerMessage({
      sessionResumptionUpdate: { resumable: true, newHandle: "newest" },
    })).toEqual([{ type: "resumption", handle: "newest" }]);
    expect(parseAssistantServerMessage({
      sessionResumptionUpdate: { resumable: false, newHandle: "" },
    })).toEqual([]);
    expect(nextResumeHandle("older", { resumable: true, newHandle: "newest" })).toBe("newest");
    expect(nextResumeHandle("older", { resumable: false, newHandle: "" })).toBe("older");
    expect(nextResumeHandle("older", { resumable: true, newHandle: "" })).toBe("older");
  });
});

describe("PCM parsing", () => {
  it("decodes base64 and holds an odd trailing byte for the next chunk", () => {
    expect([...decodeBase64(b64([0, 1, 2]))]).toEqual([0, 1, 2]);
    const first = takePcm16(decodeBase64(b64([1, 2, 3])), new Uint8Array());
    expect([...first.pcm]).toEqual([1, 2]);
    expect([...first.carry]).toEqual([3]);
    const second = takePcm16(Uint8Array.of(4), first.carry);
    expect([...second.pcm]).toEqual([3, 4]);
    expect(second.carry).toHaveLength(0);
  });
});

describe("redactSecrets", () => {
  it("removes ephemeral tokens and API keys", () => {
    const fakeKey = "AIza" + "SyA1234567890abcdefghijklmnopqrstu";
    const text = redactSecrets(`token auth_tokens/abc123 invalid, key ${fakeKey}`);
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("AIza");
    expect(text).toContain("[redacted]");
  });
});
