import { describe, expect, it } from "vitest";
import { loadMicrophone, loadShowIndicator, saveMicrophone, saveShowIndicator } from "@/settings/deviceSettings";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("device settings", () => {
  it("uses the system microphone until one is chosen, and can go back to it", () => {
    const storage = memoryStorage();
    expect(loadMicrophone(storage)).toBeNull();
    saveMicrophone("usb-mic", storage);
    expect(loadMicrophone(storage)).toBe("usb-mic");
    saveMicrophone(null, storage);
    expect(loadMicrophone(storage)).toBeNull();
  });

  it("shows the indicator unless it was turned off", () => {
    const storage = memoryStorage();
    expect(loadShowIndicator(storage)).toBe(true);
    saveShowIndicator(false, storage);
    expect(loadShowIndicator(storage)).toBe(false);
    saveShowIndicator(true, storage);
    expect(loadShowIndicator(storage)).toBe(true);
  });
});
