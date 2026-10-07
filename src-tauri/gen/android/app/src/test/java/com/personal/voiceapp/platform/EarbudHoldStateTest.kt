package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EarbudHoldStateTest {
  @Test
  fun quickTapNeverBecomesDictation() {
    val state = EarbudHoldState()
    assertTrue(state.down(85))
    assertEquals(EarbudRelease.QUICK_TAP, state.up(85))
    assertNull(state.pendingKey)
    assertFalse(state.holding)
  }

  @Test
  fun holdStartsOnceAndReleaseEndsIt() {
    val state = EarbudHoldState()
    assertTrue(state.down(85))
    assertTrue(state.beginHold())
    assertFalse(state.beginHold())
    assertTrue(state.holding)
    assertEquals(EarbudRelease.RELEASE_HOLD, state.up(85))
    assertFalse(state.holding)
  }

  @Test
  fun repeatedOrMismatchedKeysDoNotReplaceThePendingGesture() {
    val state = EarbudHoldState()
    assertTrue(state.down(85))
    assertFalse(state.down(79))
    assertEquals(EarbudRelease.IGNORE, state.up(79))
    assertEquals(85, state.pendingKey)
    assertEquals(EarbudRelease.QUICK_TAP, state.up(85))
  }

  @Test
  fun cancelOnlyReportsAnActiveHold() {
    val pending = EarbudHoldState()
    assertTrue(pending.down(85))
    assertFalse(pending.cancel())

    val holding = EarbudHoldState()
    assertTrue(holding.down(85))
    assertTrue(holding.beginHold())
    assertTrue(holding.cancel())
    assertNull(holding.pendingKey)
    assertFalse(holding.holding)
  }
}
