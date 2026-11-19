package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchWireTest {
  @Test fun requiresExactV0IdentityAndCapability() {
    assertTrue(WatchWire.accepts(1, "watch-v0", listOf("button.primary")))
    assertFalse(WatchWire.accepts(2, "watch-v0", listOf("button.primary")))
    assertFalse(WatchWire.accepts(1, "watch-v0", listOf("camera.capture")))
    assertFalse(WatchWire.accepts(1, "other", listOf("button.primary")))
  }

  @Test fun rejectsUnknownOrOversizedNotifications() {
    assertEquals("button.primary.pressed", WatchWire.event(byteArrayOf('P'.code.toByte())))
    assertEquals("device.pong", WatchWire.event(byteArrayOf('!'.code.toByte())))
    assertNull(WatchWire.event(byteArrayOf()))
    assertNull(WatchWire.event(byteArrayOf('P'.code.toByte(), 'P'.code.toByte())))
  }
}
