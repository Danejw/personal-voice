package com.personal.voiceapp.platform

/**
 * Assistant capture has to be a voice call, not a recognition recording.
 * Android applies acoustic echo cancellation on `VOICE_COMMUNICATION` while
 * `AudioManager` is in `MODE_IN_COMMUNICATION`, and the reference is playback
 * with `USAGE_VOICE_COMMUNICATION` — not a media stream. Dictation stays on
 * `VOICE_RECOGNITION` and never takes that route.
 *
 * See AudioManager.MODE_IN_COMMUNICATION, MediaRecorder.AudioSource.VOICE_COMMUNICATION,
 * and AcousticEchoCanceler.
 */
enum class CapturePurpose { DICTATION, ASSISTANT }

enum class AudioSourceChoice { VOICE_RECOGNITION, VOICE_COMMUNICATION }

enum class CommDeviceKind {
  BLE_HEADSET,
  BLUETOOTH_SCO,
  WIRED_HEADSET,
  USB_HEADSET,
  BUILTIN_SPEAKER,
  EARPIECE,
  OTHER,
}

data class CaptureConfig(
  val source: AudioSourceChoice,
  val communicationRoute: Boolean,
  val requestEffects: Boolean,
  /** Dictation may ask AudioRecord to prefer a connected headset input without entering call mode. */
  val preferHeadsetInput: Boolean,
)

data class EffectProbe(
  val available: Boolean,
  val created: Boolean,
  val enabled: Boolean,
)

data class AttachedEffects(
  val echo: EffectProbe,
  val noise: EffectProbe,
)

data class CaptureEchoStatus(
  val fullDuplex: Boolean,
  val nativePlayback: Boolean,
  val noiseSuppression: Boolean,
)

fun capturePurpose(name: String?): CapturePurpose =
  if (name == "assistant") CapturePurpose.ASSISTANT else CapturePurpose.DICTATION

fun captureConfig(purpose: CapturePurpose): CaptureConfig = when (purpose) {
  CapturePurpose.DICTATION -> CaptureConfig(
    source = AudioSourceChoice.VOICE_RECOGNITION,
    communicationRoute = false,
    requestEffects = false,
    preferHeadsetInput = true,
  )
  CapturePurpose.ASSISTANT -> CaptureConfig(
    source = AudioSourceChoice.VOICE_COMMUNICATION,
    communicationRoute = true,
    requestEffects = true,
    preferHeadsetInput = false,
  )
}

private val DEVICE_PREFERENCE = listOf(
  CommDeviceKind.BLE_HEADSET,
  CommDeviceKind.BLUETOOTH_SCO,
  CommDeviceKind.WIRED_HEADSET,
  CommDeviceKind.USB_HEADSET,
  CommDeviceKind.BUILTIN_SPEAKER,
)

/** Headset when one is connected, otherwise the loudspeaker. The earpiece is not a fallback. */
fun preferredCommunicationDevice(available: List<CommDeviceKind>): CommDeviceKind? {
  for (kind in DEVICE_PREFERENCE) {
    if (available.contains(kind)) return kind
  }
  return null
}

/** Created and enabled. Availability alone is not enough, and a failed `setEnabled` is not active. */
fun effectIsActive(probe: EffectProbe): Boolean = probe.created && probe.enabled

/**
 * Full duplex only when the voice route is up, the echo canceller is actually enabled
 * on the capture session, and playback is on that same voice path. Noise suppression
 * is not part of the decision.
 */
fun fullDuplexReady(
  config: CaptureConfig,
  routeApplied: Boolean,
  echo: EffectProbe,
  playbackReady: Boolean,
): Boolean {
  return config.communicationRoute &&
    config.source == AudioSourceChoice.VOICE_COMMUNICATION &&
    routeApplied &&
    effectIsActive(echo) &&
    playbackReady
}
