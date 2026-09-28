/** Values use the shortcut grammar parsed in `src-tauri/src/platform/windows/push_to_talk.rs`. */
export const PUSH_TO_TALK_PRESETS = [
  { value: "RightAlt", label: "Right Alt" },
  { value: "RightCtrl", label: "Right Ctrl" },
  { value: "Ctrl+Shift+Space", label: "Ctrl + Shift + Space" },
  { value: "ScrollLock", label: "Scroll Lock" },
  { value: "F9", label: "F9" },
] as const;

export const DEFAULT_PUSH_TO_TALK = "RightAlt";
const STORAGE_KEY = "settings.pushToTalk";

export function loadPushToTalk(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  return PUSH_TO_TALK_PRESETS.some((preset) => preset.value === saved) && saved ? saved : DEFAULT_PUSH_TO_TALK;
}

export function savePushToTalk(shortcut: string): void {
  localStorage.setItem(STORAGE_KEY, shortcut);
}

export function pushToTalkLabel(shortcut: string): string {
  return PUSH_TO_TALK_PRESETS.find((preset) => preset.value === shortcut)?.label ?? shortcut;
}
