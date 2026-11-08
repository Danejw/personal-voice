package com.personal.voiceapp.platform

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LgWebOsRemoteTest {
  @Test fun onlyKnownLGWebOsActionsAreExposed() {
    val allowed = listOf(
      "volume_up", "volume_down", "mute", "unmute", "get_volume",
      "play", "pause", "show_message",
    )
    for (action in allowed) assertTrue(LgWebOsRemote.supportedAction(action))
    assertFalse(LgWebOsRemote.supportedAction("shutdown"))
    assertFalse(LgWebOsRemote.supportedAction("factory_reset"))
    assertFalse(LgWebOsRemote.supportedAction("ssap://system/turnOff"))
    assertFalse(LgWebOsRemote.supportedAction(""))
  }
}
