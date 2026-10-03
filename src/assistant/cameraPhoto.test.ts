import { describe, expect, it } from "vitest";
import {
  cameraContextStartedText,
  cameraContextStoppedText,
  cameraPhotoContextText,
  cameraPhotoDetachedText,
  cameraPhotoFromFrame,
} from "@/assistant/cameraPhoto";

const TINY_JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));

describe("cameraPhoto", () => {
  it("builds a camera still from a frame", () => {
    const photo = cameraPhotoFromFrame({
      jpeg: TINY_JPEG,
      width: 640,
      height: 480,
      capturedAt: "2026-10-03T20:00:00.000Z",
      facing: "back",
      label: "Rear camera",
    });
    expect(photo.facing).toBe("back");
    expect(photo.label).toBe("Rear camera");
    expect(photo.jpeg).toBe(TINY_JPEG);
  });

  it("labels camera context distinctly from screenshots", () => {
    const note = cameraPhotoContextText({
      facing: "back",
      capturedAt: "2026-10-03T20:00:00.000Z",
    });
    expect(note).toContain("Camera photo");
    expect(note).toContain("not a screenshot");
    expect(note).not.toContain("capture_screen");
  });

  it("describes live Camera Context without saving frames", () => {
    expect(cameraContextStartedText("front")).toContain("Camera Context is on");
    expect(cameraContextStartedText("front")).toContain("not a screenshot");
    expect(cameraContextStoppedText()).toContain("Camera Context is off");
    expect(cameraPhotoDetachedText()).toContain("removed");
  });
});
