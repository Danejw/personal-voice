package com.personal.voiceapp.platform

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenShareConsentFenceTest {
  @Test fun stopBeforeConsentRejectsLateGrant() {
    val fence = ScreenShareConsentFence()
    val first = fence.begin()
    assertTrue(fence.isCurrent(first))
    fence.revoke()
    assertFalse(fence.isCurrent(first))
    val second = fence.begin()
    assertFalse(fence.isCurrent(first))
    assertTrue(fence.isCurrent(second))
  }

  @Test fun cancelledServiceIntentCannotReviveStreamAfterStop() {
    val fence = ScreenShareConsentFence()
    val request = fence.begin()
    // Native start activity may queue the service after consent.
    fence.revoke()
    assertFalse(fence.isCurrent(request))
    assertFalse(fence.isCurrent(0L))
  }
}
