package com.personal.voiceapp.platform

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceLinkNetworkTest {
  @Test
  fun acceptsOnlyPrivateLanLocators() {
    val local = InetAddress.getByName("192.168.1.25")
    val id = "00000000-0000-4000-8000-000000000001"
    val peer = DeviceLinkNetwork.parseAnnouncement("PV-DL1:$id:42001", local)
    assertEquals(id, peer?.deviceId)
    assertEquals(42001, peer?.port)
    assertEquals("192.168.1.25", peer?.host)
    assertNull(DeviceLinkNetwork.parseAnnouncement("PV-DL1:$id:80", local))
    assertNull(DeviceLinkNetwork.parseAnnouncement("PV-DL1:../other:42001", local))
    assertNull(DeviceLinkNetwork.parseAnnouncement("PV-DL1:$id:42001", InetAddress.getByName("8.8.8.8")))
  }

  @Test
  fun rejectsInternetHosts() {
    assertTrue(DeviceLinkNetwork.privateHost(InetAddress.getByName("10.0.0.5")))
    assertTrue(DeviceLinkNetwork.privateHost(InetAddress.getByName("172.16.0.1")))
    assertFalse(DeviceLinkNetwork.privateHost(InetAddress.getByName("1.1.1.1")))
  }
}
