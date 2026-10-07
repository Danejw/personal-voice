package com.personal.voiceapp.platform

interface RouteHandle {
  fun apply(device: CommDeviceKind): Boolean
  fun restore()
  fun isOpen(): Boolean
  fun reselect(): Boolean = true
}

interface CaptureHandle {
  /** Creates the recorder and returns its audio session id. Does not start reading. */
  fun open(source: AudioSourceChoice, preferHeadsetInput: Boolean): Int
  fun start()
  fun stop()
}

interface EffectsHandle {
  fun attach(sessionId: Int): AttachedEffects
  fun release()
}

interface PlaybackHandle {
  fun open(): Boolean
  fun clear()
  fun close()
}

/**
 * One Assistant or dictation capture. Assistant opens communication routing, capture
 * effects, and voice playback together. Any failure releases the pieces it opened
 * and restores the previous audio mode. `close` is safe to call twice.
 */
class AssistantAudioSession(
  private val route: RouteHandle,
  private val capture: CaptureHandle,
  private val effects: EffectsHandle,
  private val playback: PlaybackHandle,
  private val devices: () -> List<CommDeviceKind>,
) {
  var status: CaptureEchoStatus = CaptureEchoStatus(false, false, false)
    private set
  var onStatusChanged: ((CaptureEchoStatus) -> Unit)? = null
  private var running = false
  private var droppingRoute = false
  private var routeLost = false

  fun start(purpose: CapturePurpose): CaptureEchoStatus {
    routeLost = false
    val config = captureConfig(purpose)
    var routeApplied = false
    try {
      if (config.communicationRoute) {
        val device = preferredCommunicationDevice(devices()) ?: CommDeviceKind.BUILTIN_SPEAKER
        routeApplied = route.apply(device)
      }
      val sessionId = capture.open(config.source, config.preferHeadsetInput)
      var echo = EffectProbe(false, false, false)
      var noise = EffectProbe(false, false, false)
      if (config.requestEffects) {
        val attached = effects.attach(sessionId)
        echo = attached.echo
        noise = attached.noise
      }
      capture.start()
      var playbackReady = false
      if (config.communicationRoute && routeApplied) {
        playbackReady = playback.open()
        if (!playbackReady) {
          playback.close()
          route.restore()
          routeApplied = false
        }
      }
      val nativePlayback = playbackReady && routeApplied
      status = CaptureEchoStatus(
        fullDuplex = fullDuplexReady(config, routeApplied, echo, nativePlayback),
        nativePlayback = nativePlayback,
        noiseSuppression = effectIsActive(noise),
      )
      running = true
      return status
    } catch (error: Exception) {
      close()
      throw error
    }
  }

  fun reselectRoute() {
    if (!running || droppingRoute || !route.isOpen()) return
    if (!route.reselect()) noteRouteLost()
  }

  /** Incoming call, a disabled canceller, or a route that can no longer be applied. */
  fun noteRouteLost() {
    if (droppingRoute || !running || routeLost) return
    droppingRoute = true
    routeLost = true
    try {
      playback.clear()
      playback.close()
      route.restore()
      status = status.copy(fullDuplex = false, nativePlayback = false)
      onStatusChanged?.invoke(status)
    } finally {
      droppingRoute = false
    }
  }

  fun close() {
    droppingRoute = true
    routeLost = true
    try {
      try { playback.close() } catch (_: Exception) {}
      try { effects.release() } catch (_: Exception) {}
      try { capture.stop() } catch (_: Exception) {}
      try { route.restore() } catch (_: Exception) {}
    } finally {
      droppingRoute = false
      running = false
      status = CaptureEchoStatus(false, false, false)
    }
  }

  fun isRunning(): Boolean = running
}
