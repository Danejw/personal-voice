import { describe, expect, it } from "vitest";
import { assertCameraJpeg, parseCameraFacing } from "@/platform/camera/cameraLogic";

/** Tiny valid JPEG used to mirror the plugin payload shape. */
const TINY_JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9));

describe("Android camera bridge parsing helpers", () => {
  it("accepts plugin facing strings", () => {
    expect(parseCameraFacing("front")).toBe("front");
    expect(parseCameraFacing("back")).toBe("back");
    expect(parseCameraFacing("default")).toBe("default");
  });

  it("validates JPEG payloads without logging them", () => {
    expect(() => assertCameraJpeg(TINY_JPEG)).not.toThrow();
    expect(() => assertCameraJpeg("not-base64!!!")).toThrow(/could not be read/);
  });
});
