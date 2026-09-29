import type { AudioCapture } from "@/voice/audio/AudioCapture";
import { MicrophoneLease } from "@/voice/audio/microphoneLease";

export const ASSISTANT_HAS_MICROPHONE = "Assistant is using the microphone.";

/**
 * Dictation capture that refuses to open the microphone while Assistant holds it.
 * The inner capture is the existing Windows or Android implementation.
 */
export function gateDictationCapture(capture: AudioCapture, lease: MicrophoneLease): AudioCapture {
  return {
    async start(onChunk, onError) {
      if (!lease.claim("dictation")) {
        onError(ASSISTANT_HAS_MICROPHONE);
        throw new Error(ASSISTANT_HAS_MICROPHONE);
      }
      try {
        await capture.start(onChunk, onError);
      } catch (error) {
        lease.release("dictation");
        throw error;
      }
    },
    async stop(flush) {
      try {
        await capture.stop(flush);
      } finally {
        lease.release("dictation");
      }
    },
  };
}
