import { describe, expect, it } from "vitest";
import {
  DEVICE_LINK_MAX_FRAME_BYTES, DeviceLinkSeenIds, makeEnvelope,
  parseDeviceLinkEnvelope,
} from "@/device-link/protocol";

const laptop = "00000000-0000-4000-8000-000000000001";
const phone = "00000000-0000-4000-8000-000000000002";
const request = "00000000-0000-4000-8000-000000000003";
const now = 100_000;

describe("DeviceLink protocol", () => {
  it("validates a bounded reliable wake hint without executing a tool", () => {
    const frame = makeEnvelope(laptop, phone, { type: "wake", family: "remote-dictation", requestId: request }, now, request);
    expect(parseDeviceLinkEnvelope(frame, now)).toEqual(frame);
    expect(frame.expiresAt - frame.issuedAt).toBe(30_000);
    expect(parseDeviceLinkEnvelope(frame, now + 31_000)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, target: laptop }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, unrelated: "field" }, now)).toBeNull();
  });
  it("limits ephemeral cursor updates to 2 seconds and rejects malformed coordinates", () => {
    const frame = makeEnvelope(laptop, phone, { type: "cursor", x: -1500, y: 300 }, now);
    expect(parseDeviceLinkEnvelope(frame, now + 1_500)).not.toBeNull();
    expect(parseDeviceLinkEnvelope(frame, now + 2_001)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, payload: { type: "cursor", x: Infinity, y: 1 } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, expiresAt: now + 30_000 }, now)).toBeNull();
  });
  it("deduplicates request IDs across LAN and cloud paths", () => {
    const seen = new DeviceLinkSeenIds();
    const first = makeEnvelope(laptop, phone, { type: "wake", family: "computer-action", requestId: request }, now, request);
    expect(seen.accept(first, now)).toBe(true);
    expect(seen.accept(first, now + 1)).toBe(false);
    expect(seen.accept(first, now + 31_000)).toBe(false);
  });
  it("accepts only short-lived companion controls, geometry and assistant phases", () => {
    const layout = makeEnvelope(laptop, phone, {
      type: "layout", monitors: [
        { x: -1920, y: 0, width: 1920, height: 1080 },
        { x: 0, y: 0, width: 2560, height: 1440 },
      ],
    }, now);
    expect(parseDeviceLinkEnvelope(layout, now)).toEqual(layout);
    expect(parseDeviceLinkEnvelope({ ...layout, payload: {
      type: "layout", monitors: [{ x: 0, y: 0, width: -1, height: 200 }],
    } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope(layout, now + 2_100)).toBeNull();
    const control = makeEnvelope(phone, laptop, { type: "companion", action: "start" }, now);
    expect(parseDeviceLinkEnvelope(control, now)).not.toBeNull();
    expect(parseDeviceLinkEnvelope({ ...control, payload: { type: "companion", action: "send-pointer" } }, now)).toBeNull();
    const state = makeEnvelope(laptop, phone, { type: "assistant-state", phase: "speaking" }, now);
    expect(parseDeviceLinkEnvelope(state, now)).toEqual(state);
    expect(parseDeviceLinkEnvelope({ ...state, payload: { type: "assistant-state", phase: "unknown" } }, now)).toBeNull();
    const energy = makeEnvelope(laptop, phone, { type: "assistant-level", level: .62 }, now);
    expect(parseDeviceLinkEnvelope(energy, now)).toEqual(energy);
    expect(parseDeviceLinkEnvelope(energy, now + 2_100)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...energy, payload: { type: "assistant-level", level: 1.2 } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...energy, payload: { type: "assistant-level", level: -.1 } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...energy, payload: { type: "assistant-level", level: .5, text: "secret" } }, now)).toBeNull();
  });
  it("rejects oversized frames and payload type confusion", () => {
    const frame = makeEnvelope(laptop, phone, { type: "presence", state: "ready" }, now);
    expect(parseDeviceLinkEnvelope({ ...frame, payload: { type: "presence", state: "ready", text: "unsafe" } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, payload: { type: "wake", family: "computer-action", requestId: request, argument: "x".repeat(DEVICE_LINK_MAX_FRAME_BYTES) } }, now)).toBeNull();
    expect(parseDeviceLinkEnvelope({ ...frame, payload: { type: "ack", requestId: request, outcome: "done" } }, now)).toBeNull();
  });
});
