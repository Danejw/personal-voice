package com.personal.voiceapp.platform

import android.Manifest
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** An on-demand, bounded scan of advertised services. No port scanning, connection or control. */
internal object NearbyDeviceDiscovery {
  data class Device(val id: String, val name: String, val kind: String, val source: String, val detail: String)
  data class Scan(val devices: List<Device>, val bluetoothPermissionRequired: Boolean)

  private val serviceTypes = listOf(
    "_googlecast._tcp." to "media",
    "_airplay._tcp." to "display",
    "_raop._tcp." to "speaker",
    "_spotify-connect._tcp." to "speaker",
  )

  private fun identifier(source: String, key: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
    val suffix = digest.take(12).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    return source + "-" + suffix
  }

  private fun clean(value: String, limit: Int): String =
    value.filter { it >= ' ' && it != '\u007f' }.trim().take(limit)

  private fun add(
    found: ConcurrentHashMap<String, Device>, source: String, key: String,
    name: String, kind: String, detail: String,
  ) {
    val safeName = clean(name, 72)
    if (safeName.isEmpty() || found.size >= 60) return
    val id = identifier(source, key)
    found.putIfAbsent(id, Device(id, safeName, kind, source, clean(detail, 100)))
  }

  fun scan(context: Context): Scan {
    val found = ConcurrentHashMap<String, Device>()
    val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    for ((type, kind) in serviceTypes) {
      val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onServiceLost(service: NsdServiceInfo) {}
        override fun onServiceFound(service: NsdServiceInfo) {
          val name = clean(service.serviceName, 72)
          if (name.isNotEmpty()) add(found, "mdns", type + ":" + name.lowercase(), name, kind, type)
        }
      }
      try {
        nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
        listeners.add(listener)
      } catch (_: Exception) {
        // Other protocols may still find the device.
      }
    }

    val ssdpWorker = Thread { discoverSsdp(found) }.also { it.start() }
    var bluetoothPermissionRequired = false
    var bluetoothScanner: android.bluetooth.le.BluetoothLeScanner? = null
    var bluetoothCallback: ScanCallback? = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
        != PackageManager.PERMISSION_GRANTED) {
        bluetoothPermissionRequired = true
      } else {
        try {
          val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
          val scanner = adapter?.bluetoothLeScanner
          if (scanner != null) {
            val callback = object : ScanCallback() {
              override fun onScanResult(callbackType: Int, result: ScanResult) {
                // Advertised names only. Never read MAC address or infer distance from RSSI.
                val name = result.scanRecord?.deviceName ?: return
                add(found, "bluetooth", name.lowercase(), name, "unknown", "Bluetooth LE advertisement")
              }
            }
            scanner.startScan(callback)
            bluetoothScanner = scanner
            bluetoothCallback = callback
          }
        } catch (_: Exception) {
          // Bluetooth can be disabled or unavailable; network results still display.
        }
      }
    }

    try { Thread.sleep(2500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    for (listener in listeners) {
      try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
    }
    if (bluetoothScanner != null && bluetoothCallback != null) {
      try { bluetoothScanner.stopScan(bluetoothCallback) } catch (_: Exception) {}
    }
    try { ssdpWorker.join(250) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    return Scan(found.values.sortedWith(compareBy({ it.name.lowercase() }, { it.id })).take(60), bluetoothPermissionRequired)
  }

  /** Send targeted UPnP/DIAL discovery only. Do not fetch or follow untrusted LOCATION URLs. */
  private fun discoverSsdp(found: ConcurrentHashMap<String, Device>) {
    val targets = listOf(
      "urn:schemas-upnp-org:device:MediaRenderer:1",
      "urn:dial-multiscreen-org:service:dial:1",
    )
    try {
      DatagramSocket().use { socket ->
        socket.soTimeout = 300
        val destination = InetAddress.getByName("239.255.255.250")
        for (target in targets) {
          val request = (
            "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 2\r\nST: " + target + "\r\n\r\n"
          ).toByteArray(Charsets.US_ASCII)
          socket.send(DatagramPacket(request, request.size, destination, 1900))
        }
        val deadline = SystemClock.elapsedRealtime() + 2000
        while (SystemClock.elapsedRealtime() < deadline) {
          val bytes = ByteArray(4096)
          val packet = DatagramPacket(bytes, bytes.size)
          try { socket.receive(packet) } catch (_: java.net.SocketTimeoutException) { continue }
          if (!packet.address.isSiteLocalAddress && !packet.address.isLinkLocalAddress) continue
          val response = String(packet.data, packet.offset, packet.length, Charsets.US_ASCII)
          if (!response.startsWith("HTTP/1.1 200", ignoreCase = true)) continue
          val headers = response.split("\r\n").drop(1).mapNotNull { line ->
            val index = line.indexOf(':')
            if (index <= 0) null
            else line.substring(0, index).trim().lowercase() to line.substring(index + 1).trim()
          }.toMap()
          val target = headers["st"]?.lowercase() ?: continue
          if (!target.contains("mediarenderer") && !target.contains("dial")) continue
          val usn = headers["usn"]?.take(160) ?: continue
          val server = clean(headers["server"] ?: "", 72)
          val name = if (server.isNotEmpty()) server else if (target.contains("dial")) "DIAL media device" else "UPnP media renderer"
          add(found, "ssdp", usn, name, if (target.contains("dial")) "display" else "media", "UPnP / DIAL")
        }
      }
    } catch (_: Exception) {
      // Local networks may block SSDP. mDNS and BLE remain available.
    }
  }
}
