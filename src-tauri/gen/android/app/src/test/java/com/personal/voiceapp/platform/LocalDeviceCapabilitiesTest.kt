package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalDeviceCapabilitiesTest {
  @Test fun onlyPrivateLanAddressesAreTargets() {
    assertTrue(LocalDeviceCapabilities.privateIp("192.168.0.27"))
    assertTrue(LocalDeviceCapabilities.privateIp("10.1.2.3"))
    assertTrue(LocalDeviceCapabilities.privateIp("172.16.1.1"))
    assertFalse(LocalDeviceCapabilities.privateIp("172.32.1.1"))
    assertFalse(LocalDeviceCapabilities.privateIp("127.0.0.1"))
    assertFalse(LocalDeviceCapabilities.privateIp("8.8.8.8"))
    assertFalse(LocalDeviceCapabilities.privateIp("192.168.foo.7"))
  }

  @Test fun webButtonRequiresAnActualProtocolResponse() {
    val attempted = mutableListOf<Int>()
    val available = setOf(80, 443, 8080)
    assertEquals(80, LocalDeviceCapabilities.verifiedWebPort(available) {
      attempted.add(it)
      it == 80 // Old printer: TLS listener accepts TCP but cannot finish HTTPS.
    })
    assertEquals(listOf(443, 80), attempted)

    assertEquals(443, LocalDeviceCapabilities.verifiedWebPort(available) { true })
    assertNull(LocalDeviceCapabilities.verifiedWebPort(available) { false })
    assertNull(LocalDeviceCapabilities.verifiedWebPort(setOf(9100, 631)) { true })
  }

  @Test fun locationMustMatchTheRespondingDeviceIp() {
    val ip = "192.168.0.27"
    val safe = LocalDeviceCapabilities.safeLocation("http://192.168.0.27:9197/description.xml", ip)
    assertEquals("192.168.0.27", safe?.host)
    assertEquals(9197, safe?.port)
    assertNull(LocalDeviceCapabilities.safeLocation("http://192.168.0.1/private", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://127.0.0.1/secret", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://169.254.169.254/latest", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://192.168.0.27@evil.invalid/abc", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("https://192.168.0.27/abc", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://192.168.0.27:0/abc", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://192.168.0.27/abc#fragment", ip))
    assertNull(LocalDeviceCapabilities.safeLocation("http://192.168.0.27/", "8.8.8.8"))
  }
}
