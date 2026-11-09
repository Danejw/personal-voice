import { callPlugin } from "@/platform/android/voicePlatformPlugin";

/** Only Android AudioManager-connected outputs can be selected for Assistant speech. */
export interface AndroidAudioOutput {
  id: string;
  name: string;
  type: string;
  selected: boolean;
}
export interface AndroidAudioEvidence {
  outputs: AndroidAudioOutput[];
  assistantSessionActive: boolean;
  nativeTrackRoutedDeviceId: number | null;
  routeMatchesSelected: boolean;
}
export interface AndroidScreenEvidence {
  active: boolean;
  browserConnected: boolean;
  framesWritten: number;
  frameAgeMs: number | null;
  /** The tokenized URL is intentionally kept in the local UI, not sent to the model. */
  linkAvailable: boolean;
}

const validId = /^(system|audio:\d+)$/;

export function readAudioEvidence(raw: unknown): AndroidAudioEvidence {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const outputs = Array.isArray(data.outputs) ? data.outputs.filter((entry): entry is AndroidAudioOutput => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<AndroidAudioOutput>;
    return typeof item.id === "string" && validId.test(item.id) &&
      typeof item.name === "string" && typeof item.type === "string" &&
      typeof item.selected === "boolean";
  }).slice(0, 30) : [];
  return {
    outputs,
    assistantSessionActive: data.assistantSessionActive === true,
    nativeTrackRoutedDeviceId: typeof data.nativeTrackRoutedDeviceId === "number" &&
      Number.isInteger(data.nativeTrackRoutedDeviceId) ? data.nativeTrackRoutedDeviceId : null,
    routeMatchesSelected: data.routeMatchesSelected === true && data.assistantSessionActive === true,
  };
}

export function readScreenEvidence(raw: unknown): AndroidScreenEvidence {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const active = item.active === true;
  const frameCount = typeof item.framesWritten === "number" &&
    Number.isSafeInteger(item.framesWritten) && item.framesWritten >= 0 ? item.framesWritten : 0;
  return {
    active,
    browserConnected: active && item.browserConnected === true,
    framesWritten: active ? frameCount : 0,
    frameAgeMs: active && typeof item.frameAgeMs === "number" &&
      Number.isFinite(item.frameAgeMs) && item.frameAgeMs >= 0 ? item.frameAgeMs : null,
    linkAvailable: active && typeof item.url === "string" && item.url.startsWith("http://"),
  };
}

export async function androidDeviceEnvironment(): Promise<string> {
  const [audio, share] = await Promise.all([
    callPlugin<unknown>("list_assistant_audio_outputs"),
    callPlugin<unknown>("screen_share_status"),
  ]);
  const a = readAudioEvidence(audio);
  const selected = a.outputs.find(output => output.selected) ?? null;
  const screen = readScreenEvidence(share);
  return JSON.stringify({
    observation: "live_android_audio_manager_and_local_stream_service",
    available_audio_outputs: a.outputs.map(({id, name, type, selected}) => ({ id, name, type, selected })),
    selected_audio_output: selected?.id ?? null,
    assistant_session_active: a.assistantSessionActive,
    actual_audio_route_matches_selection: a.routeMatchesSelected,
    actual_routed_audio_device_id: a.nativeTrackRoutedDeviceId,
    screen_share: screen,
    confidence_note: "Connected audio sinks are observed, but that is not proof of audible speech. A connected screen browser and frames written confirm the local HTTP stream, not its TV identity or visible playback. Screen sharing URL is shown locally in Devices settings, not included in model tool results. A registered Windows PC is not proof of online presence; use its signed remote read tool.",
  });
}

/** Validates the ID against the CURRENT connected outputs, then re-reads route evidence. */
export async function routeAssistantAudio(outputId: string): Promise<string> {
  if (!validId.test(outputId)) throw new Error("Select a real audio output ID from device_environment_status.");
  const before = readAudioEvidence(await callPlugin<unknown>("list_assistant_audio_outputs"));
  const target = before.outputs.find(output => output.id === outputId);
  if (!target) throw new Error("That output isn't connected. Check Android Bluetooth settings and read device status again.");
  await callPlugin("select_assistant_audio_output", { id: outputId });
  const after = readAudioEvidence(await callPlugin<unknown>("list_assistant_audio_outputs"));
  const selected = after.outputs.find(output => output.selected);
  if (selected?.id !== outputId) {
    throw new Error("Android did not retain that output selection. Check the Bluetooth connection.");
  }
  return JSON.stringify({
    selected_output: { id: selected.id, name: selected.name, type: selected.type },
    assistant_session_active: after.assistantSessionActive,
    route_match_observed: after.routeMatchesSelected,
    result: after.routeMatchesSelected ? "native_track_reports_expected_route" : "output_preference_saved_not_audibly_verified",
    next: after.assistantSessionActive
      ? "Speak a test response and check that it is audible on the target speaker."
      : "Start Assistant and speak a test response. Only real speaker playback proves the requested effect.",
    note: "This is a reversible local output preference, not Bluetooth pairing. Media speaker playback gates the microphone during replies.",
  });
}

export async function manageAndroidScreenShare(action: "start" | "stop"): Promise<string> {
  if (action === "start") {
    const current = readScreenEvidence(await callPlugin<unknown>("screen_share_status"));
    if (current.active) {
      return JSON.stringify({ action, status: "already_active", ...current,
        next: "View the local address in Devices & Controls → Settings; check for a browser connection." });
    }
    // The OS shows a fresh MediaProjection consent dialog on every start.
    await callPlugin("start_screen_share");
  } else {
    await callPlugin("stop_screen_share");
  }
  const status = readScreenEvidence(await callPlugin<unknown>("screen_share_status"));
  if (action === "start" && !status.active) {
    throw new Error("Android screen sharing did not remain active. Check the screen capture permission and Wi-Fi connection.");
  }
  return JSON.stringify({
    action, status: status.active ? "local_stream_started" : "stopped",
    ...status,
    next: status.active
      ? "The TV must open the local link in Devices & Controls → Settings in a compatible browser. Use device_environment_status to check browser connection and frames sent; don't claim the TV displays it yet."
      : "The local screen-sharing service reports inactive; the previous link is invalid.",
  });
}
