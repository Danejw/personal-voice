package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BluetoothSpeakerOutputMatchTest {
  private val echo = BluetoothSpeakerOutputMatch.Endpoint(9, "Echo Dot", "AA:BB:CC:DD:EE:FF")
  private val other = BluetoothSpeakerOutputMatch.Endpoint(12, "Echo Dot", "11:22:33:44:55:66")

  @Test fun selectsOnlyExactProfileVerifiedAddress() {
    assertEquals(echo, BluetoothSpeakerOutputMatch.choose(
      "aa:bb:cc:dd:ee:ff", "Echo Dot",
      listOf("AA:BB:CC:DD:EE:FF"), listOf(other, echo)))
  }

  @Test fun doesNotRouteFromPairingOrNameAlone() {
    assertNull(BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      emptyList(), listOf(echo)))
    assertNull(BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      listOf(other.address), listOf(echo)))
  }

  @Test fun redactedAddressNeedsUniqueNameAndExactlyOneA2dpProfile() {
    val redacted = echo.copy(address = "")
    assertEquals(redacted, BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      listOf(echo.address), listOf(redacted)))
    assertNull(BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      listOf(echo.address), listOf(redacted, redacted.copy(id=10))))
    assertNull(BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      listOf(echo.address, other.address), listOf(redacted)))
    assertEquals(redacted.copy(name = "Different Speaker"),
      BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
        listOf(echo.address), listOf(redacted.copy(name = "Different Speaker"))))
    assertEquals(redacted.copy(address = "redacted"),
      BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
        listOf(echo.address), listOf(redacted.copy(address = "redacted"))))
  }

  @Test fun identicalSpeakerNamesCannotOverrideDifferentConcreteAddress() {
    assertNull(BluetoothSpeakerOutputMatch.choose(echo.address, echo.name,
      listOf(echo.address), listOf(other)))
  }
}
