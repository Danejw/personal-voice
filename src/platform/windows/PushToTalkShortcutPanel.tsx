import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/Tooltip";
import { SelectField } from "@/components/SelectField";
import type { HotkeyBindings, PlatformAdapter } from "@/platform/PlatformAdapter";
import {
  type CapturedKey,
  type LongPressBinding,
  type PointerModifiers,
  hotkeyListLabel,
  isMouseShortcut,
  shortcutFromKeys,
  shortcutFromMouse,
} from "@/settings/hotkeyChord";
import {
  DEFAULT_LONG_PRESS_MS,
  LONG_PRESS_MS_OPTIONS,
  MAX_BINDINGS_PER_ACTION,
  hotkeysConflict,
  loadAssistantHotkey,
  loadHandoffHotkey,
  loadPushToTalk,
  loadPushToTalkLongPress,
  loadSelectionHotkey,
  loadVoiceNoteHotkey,
  saveAssistantHotkey,
  saveHandoffHotkey,
  savePushToTalk,
  savePushToTalkLongPress,
  saveSelectionHotkey,
  saveVoiceNoteHotkey,
} from "@/settings/pushToTalk";

interface PushToTalkShortcutPanelProps {
  platform: PlatformAdapter;
}

type HotkeyAction = "dictate" | "voiceNote" | "handoff" | "selection" | "assistant";
type RecordingAction = HotkeyAction | "dictateLongPress";

const INVALID_CHORD = "Use one key or mouse button. Hold Ctrl, Shift, Alt, or Win for a combination.";
const LONG_PRESS_MOUSE_ONLY = "Long press currently supports right, middle, or side mouse buttons.";

/** Windows hold-to-talk and capture keys. Stored on this PC; they are not synced to Android. */
export function PushToTalkShortcutPanel({ platform }: PushToTalkShortcutPanelProps) {
  const [dictate, setDictate] = useState(loadPushToTalk);
  const [dictateLongPress, setDictateLongPress] = useState(loadPushToTalkLongPress);
  const [voiceNote, setVoiceNote] = useState(loadVoiceNoteHotkey);
  const [handoff, setHandoff] = useState(loadHandoffHotkey);
  const [selection, setSelection] = useState(loadSelectionHotkey);
  const [assistant, setAssistant] = useState(loadAssistantHotkey);
  const [recording, setRecording] = useState<RecordingAction | null>(null);
  const [arming, setArming] = useState<RecordingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const longPressShortcuts = dictateLongPress.map((binding) => binding.shortcut);
  const lists = { dictate, voiceNote, handoff, selection, assistant };
  const conflict = hotkeysConflict(dictate, longPressShortcuts, voiceNote, handoff, selection, assistant);
  const captureRequest = useRef(0);

  useEffect(() => {
    if (conflict || dictate.length === 0) return;
    const bindings: HotkeyBindings = {
      dictate,
      dictateLongPress,
      voiceNote,
      handoff,
      selection,
      assistant,
    };
    let cancelled = false;
    platform.setHotkeys(bindings).then(
      () => {
        if (cancelled) return;
        savePushToTalk(dictate);
        savePushToTalkLongPress(dictateLongPress);
        saveVoiceNoteHotkey(voiceNote);
        saveHandoffHotkey(handoff);
        saveSelectionHotkey(selection);
        saveAssistantHotkey(assistant);
        setError(null);
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [platform, dictate, dictateLongPress, voiceNote, handoff, selection, assistant, conflict]);

  useEffect(() => () => {
    captureRequest.current += 1;
    void platform.setHotkeyCapture(false);
  }, [platform]);

  const actionsRef = useRef({ addShortcut, cancelRecording });
  actionsRef.current = { addShortcut, cancelRecording };

  useEffect(() => {
    if (!recording) return;
    const action = recording;
    const down = new Set<string>();
    const chord: CapturedKey[] = [];
    let done = false;

    const finish = (shortcut: string | null) => {
      if (done) return;
      if (!shortcut) {
        setError(INVALID_CHORD);
        return;
      }
      done = true;
      actionsRef.current.addShortcut(action, shortcut);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (done || event.repeat) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        actionsRef.current.cancelRecording();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (down.has(event.code)) return;
      down.add(event.code);
      chord.push({ code: event.code, keyCode: event.keyCode });
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (done) return;
      down.delete(event.code);
      if (down.size > 0 || chord.length === 0) return;
      const pressed = chord.splice(0, chord.length);
      finish(shortcutFromKeys(pressed));
    };

    const onMouseDown = (event: MouseEvent) => {
      const shortcut = shortcutFromMouse(event.button, modifiersFrom(event));
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      if (done) return;
      down.clear();
      chord.length = 0;
      finish(shortcut);
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("pointerdown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("pointerdown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [recording]);

  function bindingsFor(action: HotkeyAction): string[] {
    switch (action) {
      case "dictate": return dictate;
      case "voiceNote": return voiceNote;
      case "handoff": return handoff;
      case "selection": return selection;
      case "assistant": return assistant;
      default: {
        const unhandled: never = action;
        throw new Error(`Unhandled hotkey action: ${String(unhandled)}`);
      }
    }
  }

  function apply(action: HotkeyAction, shortcuts: string[]) {
    switch (action) {
      case "dictate": setDictate(shortcuts); return;
      case "voiceNote": setVoiceNote(shortcuts); return;
      case "handoff": setHandoff(shortcuts); return;
      case "selection": setSelection(shortcuts); return;
      case "assistant": setAssistant(shortcuts); return;
      default: {
        const unhandled: never = action;
        throw new Error(`Unhandled hotkey action: ${String(unhandled)}`);
      }
    }
  }

  function addShortcut(action: RecordingAction, shortcut: string) {
    setRecording(null);
    void platform.setHotkeyCapture(false);

    if (action === "dictateLongPress") {
      if (!isMouseShortcut(shortcut)) {
        setError(LONG_PRESS_MOUSE_ONLY);
        return;
      }
      if (dictateLongPress.some((binding) => binding.shortcut === shortcut)) {
        setError(null);
        return;
      }
      if (dictateLongPress.length >= MAX_BINDINGS_PER_ACTION) {
        setError("Long press already has 8 bindings. Remove one first.");
        return;
      }
      const next = [...dictateLongPress, { shortcut, holdMs: DEFAULT_LONG_PRESS_MS }];
      if (hotkeysConflict(dictate, next.map((binding) => binding.shortcut), voiceNote, handoff, selection, assistant)) {
        setError("That key or mouse button is already used by another binding.");
        return;
      }
      setDictateLongPress(next);
      setError(null);
      return;
    }

    const current = bindingsFor(action);
    const next = current.includes(shortcut) ? current : [...current, shortcut];
    if (next.length > MAX_BINDINGS_PER_ACTION) {
      setError("This action already has 8 bindings. Remove one first.");
      return;
    }
    const candidate = { ...lists, [action]: next };
    if (hotkeysConflict(
      candidate.dictate,
      longPressShortcuts,
      candidate.voiceNote,
      candidate.handoff,
      candidate.selection,
      candidate.assistant,
    )) {
      setError("That key or mouse button is already used by another binding.");
      return;
    }
    apply(action, next);
    setError(null);
  }

  function removeShortcut(action: HotkeyAction, shortcut: string) {
    apply(action, bindingsFor(action).filter((item) => item !== shortcut));
  }

  function removeLongPress(shortcut: string) {
    setDictateLongPress((bindings) => bindings.filter((binding) => binding.shortcut !== shortcut));
  }

  function updateLongPress(shortcut: string, holdMs: number) {
    setDictateLongPress((bindings) => bindings.map((binding) =>
      binding.shortcut === shortcut ? { ...binding, holdMs } : binding
    ));
  }

  function startRecording(action: RecordingAction) {
    if (recording || arming) return;
    const request = captureRequest.current + 1;
    captureRequest.current = request;
    setArming(action);
    setError(null);
    platform.setHotkeyCapture(true).then(
      () => {
        if (captureRequest.current !== request) return;
        setArming(null);
        setRecording(action);
      },
      (reason: unknown) => {
        if (captureRequest.current !== request) return;
        setArming(null);
        setError(String(reason));
      },
    );
  }

  function cancelRecording() {
    captureRequest.current += 1;
    setArming(null);
    setRecording(null);
    void platform.setHotkeyCapture(false);
  }

  const recordError = dictate.length === 0
    ? "Hold to dictate needs a key or mouse button."
    : conflict
      ? "Each binding needs its own key or mouse button."
      : error;

  return (
    <>
      <HotkeyField
        label="Hold to dictate"
        shortcuts={dictate}
        listening={recording === "dictate"}
        canRemoveLast={false}
        disabled={arming !== null || dictate.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "dictate")}
        onRecord={() => startRecording("dictate")}
        onCancel={cancelRecording}
        onRemove={(shortcut) => removeShortcut("dictate", shortcut)}
      />
      <LongPressField
        bindings={dictateLongPress}
        listening={recording === "dictateLongPress"}
        disabled={arming !== null || dictateLongPress.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "dictateLongPress")}
        onRecord={() => startRecording("dictateLongPress")}
        onCancel={cancelRecording}
        onRemove={removeLongPress}
        onDelay={updateLongPress}
      />
      <HotkeyField
        label="Hold for a note"
        shortcuts={voiceNote}
        listening={recording === "voiceNote"}
        canRemoveLast
        disabled={arming !== null || voiceNote.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "voiceNote")}
        onRecord={() => startRecording("voiceNote")}
        onCancel={cancelRecording}
        onRemove={(shortcut) => removeShortcut("voiceNote", shortcut)}
      />
      <HotkeyField
        label="Hold for Remote Dictation"
        shortcuts={handoff}
        listening={recording === "handoff"}
        canRemoveLast
        disabled={arming !== null || handoff.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "handoff")}
        onRecord={() => startRecording("handoff")}
        onCancel={cancelRecording}
        onRemove={(shortcut) => removeShortcut("handoff", shortcut)}
      />
      <HotkeyField
        label="Capture a selection"
        shortcuts={selection}
        listening={recording === "selection"}
        canRemoveLast
        disabled={arming !== null || selection.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "selection")}
        onRecord={() => startRecording("selection")}
        onCancel={cancelRecording}
        onRemove={(shortcut) => removeShortcut("selection", shortcut)}
      />
      <HotkeyField
        label="Assistant"
        shortcuts={assistant}
        listening={recording === "assistant"}
        canRemoveLast
        disabled={arming !== null || assistant.length >= MAX_BINDINGS_PER_ACTION || (recording !== null && recording !== "assistant")}
        onRecord={() => startRecording("assistant")}
        onCancel={cancelRecording}
        onRemove={(shortcut) => removeShortcut("assistant", shortcut)}
      />
      {recordError && <p className="error" role="alert">{recordError}</p>}
    </>
  );
}

interface HotkeyFieldProps {
  label: string;
  shortcuts: readonly string[];
  listening: boolean;
  canRemoveLast: boolean;
  disabled: boolean;
  onRecord(): void;
  onCancel(): void;
  onRemove(shortcut: string): void;
}

function HotkeyField({
  label,
  shortcuts,
  listening,
  canRemoveLast,
  disabled,
  onRecord,
  onCancel,
  onRemove,
}: HotkeyFieldProps) {
  return (
    <div className="hotkey-row">
      <span className="hotkey-label">{label}</span>
      {listening ? (
        <div className="hotkey-listening" role="status">
          <span>Press a key or mouse button. Esc cancels.</span>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      ) : (
        <>
          {shortcuts.length > 0 && (
            <ul className="hotkey-bindings">
              {shortcuts.map((shortcut) => {
                const removable = canRemoveLast || shortcuts.length > 1;
                return (
                  <li key={shortcut}>
                    <span>{hotkeyListLabel([shortcut])}</span>
                    <Tooltip content={removable ? "Remove" : "Record another binding before removing this one."}>
                      <button
                        type="button"
                        className="hotkey-remove"
                        aria-label={`Remove ${hotkeyListLabel([shortcut])}`}
                        disabled={!removable || listening}
                        onClick={() => onRemove(shortcut)}
                      >
                        ×
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          )}
          <Tooltip content="Key, mouse button, or Ctrl/Shift/Alt/Win combination. Esc cancels.">
            <button
              type="button" className="secondary hotkey-add" disabled={disabled}
              onClick={onRecord}
            >
              Record
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function LongPressField({
  bindings,
  listening,
  disabled,
  onRecord,
  onCancel,
  onRemove,
  onDelay,
}: {
  bindings: readonly LongPressBinding[];
  listening: boolean;
  disabled: boolean;
  onRecord(): void;
  onCancel(): void;
  onRemove(shortcut: string): void;
  onDelay(shortcut: string, holdMs: number): void;
}) {
  return (
    <div className="hotkey-row">
      <span className="hotkey-label">Long press to dictate</span>
      {listening ? (
        <div className="hotkey-listening" role="status">
          <span>Press a mouse button. Quick clicks will stay normal. Esc cancels.</span>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      ) : (
        <>
          {bindings.length > 0 && (
            <ul className="hotkey-bindings">
              {bindings.map((binding) => (
                <li key={binding.shortcut} className="hotkey-long-press">
                  <span>{hotkeyListLabel([binding.shortcut])}</span>
                  <SelectField
                    label={`Hold time for ${hotkeyListLabel([binding.shortcut])}`}
                    value={String(binding.holdMs)}
                    options={LONG_PRESS_MS_OPTIONS.map((milliseconds) => ({
                      value: String(milliseconds),
                      label: `${milliseconds} ms`,
                    }))}
                    onChange={(value) => onDelay(binding.shortcut, Number(value))}
                  />
                  <button
                    type="button"
                    className="hotkey-remove"
                    aria-label={`Remove long press ${hotkeyListLabel([binding.shortcut])}`}
                    onClick={() => onRemove(binding.shortcut)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Tooltip content="Quick click stays normal. Holding past the threshold starts Dictation; release finalizes it.">
            <button
              type="button" className="secondary hotkey-add" disabled={disabled}
              onClick={onRecord}
            >
              Record
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function modifiersFrom(event: MouseEvent): PointerModifiers {
  return {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    win: event.metaKey,
  };
}
