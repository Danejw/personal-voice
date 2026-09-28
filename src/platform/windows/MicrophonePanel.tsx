import { useEffect, useState } from "react";
import { SelectField } from "@/components/SelectField";
import { listAudioInputs, microphoneOptions } from "@/platform/microphones";
import type { AudioInput } from "@/platform/microphones";
import { loadMicrophone, saveMicrophone } from "@/settings/deviceSettings";

/** Which input dictation records from. Stored on this computer only; applies from the next press. */
export function MicrophonePanel() {
  const [selected, setSelected] = useState(loadMicrophone);
  const [inputs, setInputs] = useState<AudioInput[]>([]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    let active = true;
    const refresh = () => {
      listAudioInputs().then((next) => { if (active) setInputs(next); }, () => undefined);
    };
    refresh();
    media.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      media.removeEventListener("devicechange", refresh);
    };
  }, []);

  function onChange(value: string) {
    const deviceId = value || null;
    saveMicrophone(deviceId);
    setSelected(deviceId);
  }

  const unlabeled = inputs.length > 0 && inputs.every((input) => !input.label);
  return (
    <>
      <SelectField label="Microphone" value={selected ?? ""} options={microphoneOptions(inputs, selected)} onChange={onChange} />
      {unlabeled && <p className="hint">Device names appear after your first dictation.</p>}
    </>
  );
}
