package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanDeviceDiscoveryTest {
  @Test fun scansTheCurrentSlash24WithoutProbingItself() {
    val targets = LanDeviceDiscovery.addresses("192.168.1.101", 24)
    assertEquals(253, targets.size)
    assertEquals("192.168.1.1", targets.first())
    assertEquals("192.168.1.254", targets.last())
    assertFalse(targets.contains("192.168.1.101"))
    assertFalse(targets.contains("192.168.1.0"))
    assertFalse(targets.contains("192.168.1.255"))
  }

  @Test fun respectsSmallerSubnetsAndDoesNotEscapeThem() {
    assertEquals(listOf("10.0.0.2"), LanDeviceDiscovery.addresses("10.0.0.1", 30))
    val targets = LanDeviceDiscovery.addresses("172.16.7.110", 25)
    assertEquals(125, targets.size)
    assertTrue(targets.all { it.startsWith("172.16.7.") })
    assertFalse(targets.contains("172.16.7.110"))
  }

  @Test fun boundsWideSubnetsToCurrentSlash24() {
    val targets = LanDeviceDiscovery.addresses("10.2.3.50", 16)
    assertEquals(253, targets.size)
    assertTrue(targets.all { it.startsWith("10.2.3.") })
  }

  @Test fun refusesPublicOrInvalidAddresses() {
    assertTrue(LanDeviceDiscovery.addresses("8.8.8.8", 24).isEmpty())
    assertTrue(LanDeviceDiscovery.addresses("192.168.1.18", 0).isEmpty())
    assertTrue(LanDeviceDiscovery.addresses("192.168.1.18", 31).isEmpty())
    assertTrue(LanDeviceDiscovery.addresses("192.168.invalid.18", 24).isEmpty())
  }
}
