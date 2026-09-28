import type { SelectOption } from "@/components/SelectField";

/** The parts of `MediaDeviceInfo` the picker needs. */
export interface AudioInput {
  deviceId: string;
  label: string;
}

/** Chromium lists these aliases next to the real devices. */
const ALIASES = new Set(["default", "communications"]);

/**
 * Picker options: the system default first (value `""`), then each real input. A saved
 * microphone that isn't connected stays listed, so the choice isn't silently lost.
 */
export function microphoneOptions(inputs: readonly AudioInput[], selected: string | null): SelectOption[] {
  const systemDefault = inputs.find((input) => input.deviceId === "default")?.label.replace(/^Default - /, "");
  const devices = inputs
    .filter((input) => input.deviceId && !ALIASES.has(input.deviceId))
    .map((input, index) => ({ value: input.deviceId, label: input.label || `Microphone ${index + 1}` }));
  const options = [{ value: "", label: systemDefault ? `System default (${systemDefault})` : "System default" }, ...devices];
  if (selected && !devices.some((device) => device.value === selected)) {
    options.push({ value: selected, label: "Chosen microphone (not connected)" });
  }
  return options;
}

/** Audio inputs known to the webview. Labels are empty until microphone access has been granted once. */
export async function listAudioInputs(): Promise<AudioInput[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput").map(({ deviceId, label }) => ({ deviceId, label }));
}
