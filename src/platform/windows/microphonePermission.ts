import { VOICE_AUDIO } from "@/platform/BrowserAudioCapture";

/**
 * Follows the browser microphone permission. A missing Permissions API counts as not granted;
 * Allow still calls `getUserMedia`, which is what Windows WebView2 remembers.
 */
export async function watchMicrophone(onChange: (granted: boolean) => void): Promise<() => void> {
  const permissions = navigator.permissions;
  if (!permissions?.query) {
    onChange(false);
    return () => {};
  }
  try {
    const status = await permissions.query({ name: "microphone" });
    const notify = () => onChange(status.state === "granted");
    notify();
    status.addEventListener("change", notify);
    return () => status.removeEventListener("change", notify);
  } catch {
    onChange(false);
    return () => {};
  }
}

/** Prompts for the microphone, then releases it so dictation can open it later. */
export async function requestMicrophoneAccess(): Promise<void> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error("Microphone capture is unavailable in this app.");
  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({ audio: VOICE_AUDIO, video: false });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("Microphone access was blocked. Allow it for Personal Voice, then try again.", { cause: error });
    }
    if (error instanceof Error) throw error;
    throw new Error("Couldn't use the microphone.", { cause: error });
  }
  for (const track of stream.getTracks()) track.stop();
}
