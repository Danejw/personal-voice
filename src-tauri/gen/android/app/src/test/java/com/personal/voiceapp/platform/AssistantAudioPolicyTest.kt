package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantAudioPolicyTest {
  @Test
  fun dictationStaysOnRecognitionWithoutCommunicationRouting() {
    assertEquals(CapturePurpose.DICTATION, capturePurpose(null))
    assertEquals(CapturePurpose.DICTATION, capturePurpose("dictation"))
    assertEquals(CapturePurpose.DICTATION, capturePurpose("nope"))
    val config = captureConfig(CapturePurpose.DICTATION)
    assertEquals(AudioSourceChoice.VOICE_RECOGNITION, config.source)
    assertFalse(config.communicationRoute)
    assertFalse(config.requestEffects)
  }

  @Test
  fun assistantUsesVoiceCommunicationAndRequestsEffects() {
    assertEquals(CapturePurpose.ASSISTANT, capturePurpose("assistant"))
    val config = captureConfig(CapturePurpose.ASSISTANT)
    assertEquals(AudioSourceChoice.VOICE_COMMUNICATION, config.source)
    assertTrue(config.communicationRoute)
    assertTrue(config.requestEffects)
  }

  @Test
  fun prefersAHeadsetThenTheSpeakerAndNeverTheEarpiece() {
    assertEquals(
      CommDeviceKind.BLE_HEADSET,
      preferredCommunicationDevice(listOf(CommDeviceKind.BUILTIN_SPEAKER, CommDeviceKind.BLE_HEADSET, CommDeviceKind.EARPIECE)),
    )
    assertEquals(
      CommDeviceKind.BLUETOOTH_SCO,
      preferredCommunicationDevice(listOf(CommDeviceKind.BUILTIN_SPEAKER, CommDeviceKind.BLUETOOTH_SCO)),
    )
    assertEquals(
      CommDeviceKind.WIRED_HEADSET,
      preferredCommunicationDevice(listOf(CommDeviceKind.EARPIECE, CommDeviceKind.WIRED_HEADSET, CommDeviceKind.BUILTIN_SPEAKER)),
    )
    assertEquals(
      CommDeviceKind.USB_HEADSET,
      preferredCommunicationDevice(listOf(CommDeviceKind.USB_HEADSET, CommDeviceKind.BUILTIN_SPEAKER)),
    )
    assertEquals(
      CommDeviceKind.BUILTIN_SPEAKER,
      preferredCommunicationDevice(listOf(CommDeviceKind.EARPIECE, CommDeviceKind.BUILTIN_SPEAKER)),
    )
    assertNull(preferredCommunicationDevice(listOf(CommDeviceKind.EARPIECE, CommDeviceKind.OTHER)))
    assertNull(preferredCommunicationDevice(emptyList()))
  }

  @Test
  fun fullDuplexRequiresAnEnabledCancellerAndVoicePlayback() {
    val assistant = captureConfig(CapturePurpose.ASSISTANT)
    val enabled = EffectProbe(available = true, created = true, enabled = true)
    val requestedOnly = EffectProbe(available = true, created = true, enabled = false)
    val missing = EffectProbe(available = false, created = false, enabled = false)
    val noiseOff = EffectProbe(available = false, created = false, enabled = false)
    assertTrue(effectIsActive(enabled))
    assertFalse(effectIsActive(requestedOnly))
    assertFalse(effectIsActive(EffectProbe(available = true, created = false, enabled = false)))
    assertTrue(fullDuplexReady(assistant, routeApplied = true, echo = enabled, playbackReady = true))
    assertFalse(fullDuplexReady(assistant, routeApplied = true, echo = requestedOnly, playbackReady = true))
    assertFalse(fullDuplexReady(assistant, routeApplied = true, echo = missing, playbackReady = true))
    assertFalse(fullDuplexReady(assistant, routeApplied = false, echo = enabled, playbackReady = true))
    assertFalse(fullDuplexReady(assistant, routeApplied = true, echo = enabled, playbackReady = false))
    assertFalse(fullDuplexReady(captureConfig(CapturePurpose.DICTATION), true, enabled, true))
    assertFalse(effectIsActive(noiseOff))
  }
}

class AssistantAudioSessionTest {
  @Test
  fun assistantSessionIsFullDuplexOnlyWhenTheCancellerAndPlaybackAreUp() {
    val harness = Harness()
    val status = harness.session.start(CapturePurpose.ASSISTANT)
    assertTrue(status.fullDuplex)
    assertTrue(status.nativePlayback)
    assertTrue(status.noiseSuppression)
    assertEquals(listOf("open:VOICE_COMMUNICATION", "start"), harness.capture.calls)
    assertEquals(1, harness.route.applied)
    assertEquals(1, harness.effects.attached)
    assertEquals(1, harness.playback.opened)
    assertEquals(0, harness.route.restored)
  }

  @Test
  fun dictationDoesNotTouchCommunicationRoutingOrEffects() {
    val harness = Harness()
    val status = harness.session.start(CapturePurpose.DICTATION)
    assertFalse(status.fullDuplex)
    assertFalse(status.nativePlayback)
    assertFalse(status.noiseSuppression)
    assertEquals(listOf("open:VOICE_RECOGNITION", "start"), harness.capture.calls)
    assertEquals(0, harness.route.applied)
    assertEquals(0, harness.effects.attached)
    assertEquals(0, harness.playback.opened)
  }

  @Test
  fun aCancellerThatDoesNotStayEnabledIsNotFullDuplex() {
    val harness = Harness()
    harness.effects.echo = EffectProbe(available = true, created = true, enabled = false)
    val status = harness.session.start(CapturePurpose.ASSISTANT)
    assertFalse(status.fullDuplex)
    assertTrue(status.nativePlayback)
    assertEquals(0, harness.route.restored)
  }

  @Test
  fun noiseSuppressionIsReportedSeparatelyFromEchoCancellation() {
    val harness = Harness()
    harness.effects.noise = EffectProbe(available = true, created = false, enabled = false)
    val status = harness.session.start(CapturePurpose.ASSISTANT)
    assertTrue(status.fullDuplex)
    assertFalse(status.noiseSuppression)
  }

  @Test
  fun playbackFailureRestoresTheRouteAndDoesNotClaimDuplex() {
    val harness = Harness()
    harness.playback.openResult = false
    val status = harness.session.start(CapturePurpose.ASSISTANT)
    assertFalse(status.fullDuplex)
    assertFalse(status.nativePlayback)
    assertEquals(1, harness.route.restored)
    assertEquals(1, harness.playback.closed)
    assertTrue(harness.capture.calls.contains("start"))
    assertFalse(harness.route.open)
  }

  @Test
  fun aRouteThatCannotBeAppliedStillStartsCaptureWithoutDuplex() {
    val harness = Harness()
    harness.route.applyResult = false
    val status = harness.session.start(CapturePurpose.ASSISTANT)
    assertFalse(status.fullDuplex)
    assertFalse(status.nativePlayback)
    assertEquals(0, harness.playback.opened)
    assertEquals(0, harness.route.restored)
    assertTrue(harness.capture.calls.contains("start"))
  }

  @Test
  fun aFailedStartReleasesEffectsCaptureAndTheRoute() {
    val harness = Harness()
    harness.capture.failStart = true
    try {
      harness.session.start(CapturePurpose.ASSISTANT)
      throw AssertionError("start should have failed")
    } catch (error: IllegalStateException) {
      assertEquals("busy", error.message)
    }
    assertEquals(1, harness.effects.released)
    assertTrue(harness.capture.calls.contains("stop"))
    assertEquals(1, harness.route.restored)
    assertFalse(harness.session.isRunning())
    assertFalse(harness.route.open)
    assertEquals(1, harness.playback.closed)
  }

  @Test
  fun closeIsIdempotentAndRouteLossDropsDuplex() {
    val harness = Harness()
    val seen = mutableListOf<CaptureEchoStatus>()
    harness.session.onStatusChanged = { seen.add(it) }
    harness.session.start(CapturePurpose.ASSISTANT)
    harness.session.noteRouteLost()
    assertEquals(1, seen.size)
    assertFalse(seen[0].fullDuplex)
    assertFalse(seen[0].nativePlayback)
    assertEquals(1, harness.playback.cleared)
    assertEquals(1, harness.route.restored)
    harness.session.noteRouteLost()
    assertEquals(1, seen.size)

    harness.session.close()
    harness.session.close()
    assertEquals(2, harness.effects.released)
    assertEquals(1, harness.route.restored)
    assertFalse(harness.session.isRunning())
    assertFalse(harness.session.status.fullDuplex)
  }

  @Test
  fun aFailedReselectDropsTheVoiceRoute() {
    val harness = Harness()
    harness.session.start(CapturePurpose.ASSISTANT)
    harness.route.reselectResult = false
    harness.session.reselectRoute()
    assertFalse(harness.session.status.fullDuplex)
    assertFalse(harness.route.open)
    assertEquals(1, harness.playback.cleared)
  }

  private class Harness {
    val route = FakeRoute()
    val capture = FakeCapture()
    val effects = FakeEffects()
    val playback = FakePlayback()
    val session = AssistantAudioSession(route, capture, effects, playback) {
      listOf(CommDeviceKind.BUILTIN_SPEAKER)
    }
  }

  private class FakeRoute : RouteHandle {
    var applyResult = true
    var reselectResult = true
    var applied = 0
    var restored = 0
    var open = false
    override fun apply(device: CommDeviceKind): Boolean {
      applied += 1
      open = applyResult
      return applyResult
    }
    override fun restore() {
      if (!open) return
      open = false
      restored += 1
    }
    override fun isOpen(): Boolean = open
    override fun reselect(): Boolean = reselectResult
  }

  private class FakeCapture : CaptureHandle {
    val calls = mutableListOf<String>()
    var failStart = false
    override fun open(source: AudioSourceChoice): Int {
      calls.add("open:${source.name}")
      return 7
    }
    override fun start() {
      calls.add("start")
      if (failStart) throw IllegalStateException("busy")
    }
    override fun stop() {
      calls.add("stop")
    }
  }

  private class FakeEffects : EffectsHandle {
    var echo = EffectProbe(available = true, created = true, enabled = true)
    var noise = EffectProbe(available = true, created = true, enabled = true)
    var attached = 0
    var released = 0
    override fun attach(sessionId: Int): AttachedEffects {
      attached += 1
      return AttachedEffects(echo, noise)
    }
    override fun release() {
      released += 1
    }
  }

  private class FakePlayback : PlaybackHandle {
    var openResult = true
    var opened = 0
    var cleared = 0
    var closed = 0
    override fun open(): Boolean {
      opened += 1
      return openResult
    }
    override fun clear() {
      cleared += 1
    }
    override fun close() {
      closed += 1
    }
  }
}
