package com.personal.voiceapp.platform

import org.junit.Assert.assertTrue
import org.junit.Test

class DictationCuePlayerTest {
  @Test
  fun readyAndDoneCuesStayShortSubtleAndDistinct() {
    val ready = dictationCueSpec(DictationCueKind.READY)
    val done = dictationCueSpec(DictationCueKind.DONE)

    assertTrue(ready.durationMs < 100)
    assertTrue(done.durationMs < 100)
    assertTrue(ready.amplitude < 0.10)
    assertTrue(done.amplitude < 0.10)
    assertTrue(ready.toHz > ready.fromHz)
    assertTrue(done.toHz < done.fromHz)
  }
}
