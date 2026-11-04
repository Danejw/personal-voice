package com.personal.voiceapp.platform

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DevicePairingKeysTest {
  @Test
  fun convertsDerToFixedWidthP1363Signature() {
    // Two small positive integers: r=1, s=2.
    val der = byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02)
    val expected = ByteArray(64)
    expected[31] = 1
    expected[63] = 2
    assertArrayEquals(expected, DevicePairingKeys.derToP1363(der))
  }

  @Test
  fun handlesDerSignPadding() {
    val der = byteArrayOf(0x30, 0x08, 0x02, 0x02, 0x00, 0x80.toByte(),
      0x02, 0x02, 0x00, 0x90.toByte())
    val expected = ByteArray(64)
    expected[31] = 0x80.toByte()
    expected[63] = 0x90.toByte()
    assertArrayEquals(expected, DevicePairingKeys.derToP1363(der))
  }

  @Test
  fun rejectsTrailingAndIncorrectDerLengths() {
    assertThrows(IllegalArgumentException::class.java) {
      DevicePairingKeys.derToP1363(byteArrayOf(0x30, 0x01, 0x00))
    }
    assertThrows(IllegalArgumentException::class.java) {
      DevicePairingKeys.derToP1363(byteArrayOf(0x30, 0x05, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02))
    }
  }
}
