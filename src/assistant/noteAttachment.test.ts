import { describe, expect, it } from "vitest";
import { capturedImageFile, noteAttachmentFile } from "@/assistant/noteAttachment";

describe("captured note images", () => {
  it("converts the captured screen JPEG into a real private-uploadable File", async () => {
    const jpeg = btoa(String.fromCharCode(255, 216, 255, 217));
    const file = capturedImageFile({ source: "screenshot", jpeg, capturedAt: "2026-10-09T12:13:14.000Z" });
    expect(file.name).toMatch(/^screenshot-/);
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(4);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([255, 216, 255, 217]);
  });

  it("preserves any explicitly selected file type without converting the bytes", async () => {
    const document = new File(["%PDF-1.7"], "project.pdf", { type: "application/pdf" });
    expect(noteAttachmentFile(document)).toBe(document);
    expect(await noteAttachmentFile(document).text()).toBe("%PDF-1.7");
  });

  it("retains the camera source and rejects invalid/corrupted images", () => {
    const jpeg = btoa(String.fromCharCode(255, 216, 255, 217));
    const photo = capturedImageFile({ source: "camera_photo", jpeg, capturedAt: "2026-10-09T12:13:14Z" });
    expect(photo.name).toMatch(/^camera-photo-/);
    expect(() => capturedImageFile({ source: "screenshot", jpeg: btoa("not jpeg"), capturedAt: "2026-10-09T12:13:14Z" }))
      .toThrow("invalid or too large");
  });
});
