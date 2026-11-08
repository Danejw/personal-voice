package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyDeviceDiscoveryTest {
  private fun device(
    id: String, name: String, source: String, observed: Boolean,
    paired: Boolean = false, ip: String? = null, ports: List<Int> = emptyList(),
    kind: String = "unknown",
  ) = NearbyDeviceDiscovery.Device(
    id = id, name = name, kind = kind, source = source, detail = source,
    ipAddress = ip, paired = paired, ports = ports, observedNow = observed,
  )

  @Test fun mdnsResolutionReplacesUnaddressedAdvertisement() {
    val initial = device("mdns-abcdef012345", "HP LaserJet", "mdns", true)
    val resolved = initial.copy(ipAddress = "192.168.0.35", ports = listOf(80, 631))
    val merged = NearbyDeviceDiscovery.mergeObservations(initial, resolved)
    assertEquals("192.168.0.35", merged.ipAddress)
    assertEquals(listOf(80, 631), merged.ports)
    assertEquals("192.168.0.35",
      NearbyDeviceDiscovery.mergeObservations(merged, initial).ipAddress)
  }

  @Test fun bluetoothKeepsLiveObservationAndStoredNameInEitherOrder() {
    val live = device("bt-abcdef012345", "Bluetooth LE device", "bluetooth", true)
    val saved = device("bt-abcdef012345", "LG webOS TV", "bluetooth-paired",
      false, paired = true, kind = "speaker")
    for (result in listOf(
      NearbyDeviceDiscovery.mergeObservations(live, saved),
      NearbyDeviceDiscovery.mergeObservations(saved, live),
    )) {
      assertEquals("LG webOS TV", result.name)
      assertEquals("speaker", result.kind)
      assertEquals("bluetooth", result.source)
      assertTrue(result.paired)
      assertTrue(result.observedNow)
    }
    assertFalse(saved.observedNow)
  }
}
