import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("Windows WebView2 environment consistency", () => {
  it("uses identical browser arguments for every startup webview", () => {
    // On Windows, these webviews share a WebView2 environment. Mixing arguments
    // can fail initialization with HRESULT 0x8007139F before Tauri setup runs.
    const windows = tauriConfig.app.windows;
    expect(windows.map((window) => window.label)).toContain("computer-visual");
    const browserArgs = windows.map((window) => window.additionalBrowserArgs);
    expect(browserArgs.every((args) => typeof args === "string" && args.length > 0)).toBe(true);
    expect(new Set(browserArgs).size).toBe(1);
  });
});
