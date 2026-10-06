import { describe, expect, it } from "vitest";
import { isMouseShortcut, shortcutFromKeys, shortcutFromMouse } from "@/settings/hotkeyChord";
import { hotkeysConflict } from "@/settings/pushToTalk";

describe("hotkeysConflict", () => {
  it("lets one action use several bindings and rejects a shared one", () => {
    expect(hotkeysConflict(["RightAlt", "Mouse5"], [], [], [])).toBe(false);
    expect(hotkeysConflict(["RightAlt"], ["Mouse4"], ["Mouse5"], ["Alt+S"])).toBe(false);
    expect(hotkeysConflict(["F9"], ["F9"], [], [])).toBe(true);
    expect(hotkeysConflict(["Mouse4"], ["Mouse5"], ["Mouse4"], [])).toBe(true);
    expect(hotkeysConflict(["Ctrl+Shift+A"], ["Shift+Ctrl+A"], [], [])).toBe(true);
    expect(hotkeysConflict(["A"], ["VK65"], [], [])).toBe(true);
    expect(hotkeysConflict(["Alt+S"], [], [], ["Alt+S"])).toBe(true);
    expect(hotkeysConflict(["RightAlt"], [], [], [], ["RightAlt"])).toBe(true);
    expect(hotkeysConflict(["RightAlt"], [], [], [], ["Ctrl+Alt+A"])).toBe(false);
  });
});

describe("long-press shortcut eligibility", () => {
  it("allows mouse buttons but not keyboard keys", () => {
    expect(isMouseShortcut("MouseRight")).toBe(true);
    expect(isMouseShortcut("Ctrl+Mouse4")).toBe(true);
    expect(isMouseShortcut("RightAlt")).toBe(false);
  });
});

describe("shortcut recording", () => {
  it("records a lone key, a modifier key, and a combination", () => {
    expect(shortcutFromKeys([{ code: "AltRight", keyCode: 18 }])).toBe("RightAlt");
    expect(shortcutFromKeys([
      { code: "ControlLeft", keyCode: 17 },
      { code: "ShiftLeft", keyCode: 16 },
      { code: "Space", keyCode: 32 },
    ])).toBe("Ctrl+Shift+Space");
    expect(shortcutFromKeys([{ code: "KeyK", keyCode: 75 }])).toBe("K");
    expect(shortcutFromKeys([
      { code: "ControlLeft", keyCode: 17 },
      { code: "ShiftLeft", keyCode: 16 },
    ])).toBeNull();
  });

  it("records a mouse button with the modifiers that are held", () => {
    expect(shortcutFromMouse(2, { ctrl: false, shift: false, alt: false, win: false })).toBe("MouseRight");
    expect(shortcutFromMouse(4, { ctrl: false, shift: false, alt: false, win: false })).toBe("Mouse5");
    expect(shortcutFromMouse(3, { ctrl: true, shift: false, alt: false, win: false })).toBe("Ctrl+Mouse4");
    expect(shortcutFromMouse(0, { ctrl: false, shift: false, alt: false, win: false })).toBeNull();
  });

  it("lets Dictation keep a keyboard hold and add right mouse as another hold", () => {
    expect(hotkeysConflict(["RightAlt", "MouseRight"], [], [], [], [])).toBe(false);
  });
});
