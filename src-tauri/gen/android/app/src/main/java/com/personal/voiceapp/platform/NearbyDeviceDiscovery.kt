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
import java.net.Inet4Address
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** User-triggered LAN, service and Bluetooth discovery. Does not authorize device control. */
internal object NearbyDeviceDiscovery {
  data class Device(
    val id: String, val name: String, val kind: String, val source: String, val detail: String,
    val ipAddress: String? = null, val signalDbm: Int? = null, val paired: Boolean = false,
    val ports: List<Int> = emptyList(), val descriptionUrl: String? = null,
    val observedNow: Boolean = true,
  )
  data class Scan(
    val devices: List<Device>, val bluetoothPermissionRequired: Boolean,
    val networkLabel: String, val networkLimited: Boolean,
  )

  /** Never export Bluetooth hardware addresses to JS or model tool results. */
  data class BluetoothTarget(val id: String, val address: String, val name: String,
    val kind: String, val paired: Boolean, val observedNow: Boolean)

  private val radioAddresses = ConcurrentHashMap<String, String>()
  @Volatile private var recentBluetooth: Map<String, Device> = emptyMap()
  @Volatile private var bluetoothScanAt = 0L
  private const val BLUETOOTH_TTL_MS = 180_000L

  fun bluetoothTarget(id: String): BluetoothTarget? {
    if (!id.startsWith("bt-") || SystemClock.elapsedRealtime() - bluetoothScanAt > BLUETOOTH_TTL_MS) return null
    val item = recentBluetooth[id] ?: return null
    val address = radioAddresses[id] ?: return null
    return BluetoothTarget(id, address, item.name, item.kind, item.paired, item.observedNow)
  }

  private val serviceTypes = listOf(
    "_googlecast._tcp." to "media",
    "_airplay._tcp." to "display",
    "_raop._tcp." to "speaker",
    "_spotify-connect._tcp." to "speaker",
    "_workstation._tcp." to "computer",
    "_smb._tcp." to "computer",
    "_ssh._tcp." to "server",
    "_ipp._tcp." to "printer",
    "_printer._tcp." to "printer",
    "_http._tcp." to "unknown",
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
    ipAddress: String? = null, signalDbm: Int? = null, paired: Boolean = false,
    ports: List<Int> = emptyList(), descriptionUrl: String? = null,
    observedNow: Boolean = true,
  ) {
    val safeName = clean(name, 72)
    if (safeName.isEmpty() || found.size >= 350) return
    // BLE, Classic and paired Bluetooth records share the same hashed hardware identity.
    val id = identifier(if (source.startsWith("bluetooth")) "bt" else source, key)
    val fresh = Device(id, safeName, kind, source, clean(detail, 100), ipAddress, signalDbm,
      paired, ports, descriptionUrl, observedNow)
    if (source.startsWith("bluetooth")) radioAddresses[id] = key
    found.compute(id) { _, previous -> mergeObservations(previous, fresh) }
  }

  /** Keep a resolved mDNS endpoint and a saved Bluetooth identity when observations converge. */
  internal fun mergeObservations(previous: Device?, fresh: Device): Device {
    if (previous == null) return fresh
    if (!fresh.id.startsWith("bt-")) {
      // mDNS resolution follows the service-name advertisement for the same ID.
      // Never downgrade a resolved private-IP endpoint back to an unaddressed name.
      return (if (fresh.ipAddress != null) fresh else previous).copy(
        observedNow = fresh.observedNow || previous.observedNow,
        paired = fresh.paired || previous.paired)
    }
    val live = when {
      fresh.observedNow && !previous.observedNow -> fresh
      previous.observedNow && !fresh.observedNow -> previous
      fresh.signalDbm != null && previous.signalDbm == null -> fresh
      else -> previous
    }
    val other = if (live === fresh) previous else fresh
    val anonymous = setOf("Bluetooth device", "Bluetooth LE device", "Paired Bluetooth device")
    val name = if (live.name in anonymous && other.name !in anonymous) other.name else live.name
    val kind = if (live.kind == "unknown" && other.kind != "unknown") other.kind else live.kind
    return live.copy(name = name, kind = kind,
      paired = fresh.paired || previous.paired,
      observedNow = fresh.observedNow || previous.observedNow,
      signalDbm = live.signalDbm ?: other.signalDbm)
  }

  fun scan(context: Context): Scan {
    // Every new scan invalidates old IDs, including a forgotten or renamed speaker.
    bluetoothScanAt = 0L
    recentBluetooth = emptyMap()
    radioAddresses.clear()
    val found = ConcurrentHashMap<String, Device>()
    val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    // Resolve discovered DNS-SD endpoints without extending the scan indefinitely.
    // Legacy Android NSD permits only one outstanding resolve request per manager.
    val resolvers = Executors.newSingleThreadExecutor()
    val resolutionStalled = AtomicBoolean(false)
    val queuedResolutions = AtomicInteger(0)
    val seenServices = ConcurrentHashMap.newKeySet<String>()
    for ((type, kind) in serviceTypes) {
      val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
        override fun onServiceLost(service: NsdServiceInfo) {}
        override fun onServiceFound(service: NsdServiceInfo) {
          val name = clean(service.serviceName, 72)
          if (name.isEmpty()) return
          val key = type + ":" + name.lowercase()
          add(found, "mdns", key, name, kind, type)
          if (!seenServices.add(key) || queuedResolutions.incrementAndGet() > 24) return
          try { resolvers.execute {
            // A timed-out native resolve may still be active. Do not start another.
            if (resolutionStalled.get()) return@execute
            val finished = CountDownLatch(1)
            val callback = object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) { finished.countDown() }
              override fun onServiceResolved(info: NsdServiceInfo) {
                // Android 14+ may publish multiple IPv4/IPv6 host addresses.
                val address = (listOfNotNull(info.host) +
                  (if (Build.VERSION.SDK_INT >= 34) info.hostAddresses else emptyList()))
                  .firstOrNull { it is Inet4Address && it.isSiteLocalAddress } as? Inet4Address
                if (address != null && info.port in 1..65535) {
                  // Resolution gives an endpoint, never control permission.
                  add(found, "mdns", key, name, kind, type + " · TCP " + info.port,
                    ipAddress = address.hostAddress, ports = listOf(info.port))
                }
                finished.countDown()
              }
            }
            try {
              @Suppress("DEPRECATION")
              nsd.resolveService(service, callback)
              if (!finished.await(1600, TimeUnit.MILLISECONDS)) resolutionStalled.set(true)
            } catch (_: Exception) { /* Name remains visible without an endpoint. */ }
          } } catch (_: java.util.concurrent.RejectedExecutionException) {
            // Discovery already stopped after its bounded scan window.
          }
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
    var lanScan = LanDeviceDiscovery.Scan(emptyList(), "Wi-Fi scan unavailable", false)
    val lanWorker = Thread {
      try {
        val result = LanDeviceDiscovery.scan(context)
        lanScan = result
        for (host in result.devices) {
          add(found, "lan", host.ip, "Device " + host.ip, host.kind,
            "TCP " + host.ports.joinToString(", "), ipAddress = host.ip, ports = host.ports)
        }
      } catch (_: Exception) { /* Media and Bluetooth scanning still continue. */ }
    }.also { it.start() }
    val permissionScan = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED
    val permissionConnect = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    val bluetoothPermissionRequired = permissionScan || permissionConnect
    var bluetoothScanner: android.bluetooth.le.BluetoothLeScanner? = null
    var bluetoothCallback: ScanCallback? = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!permissionScan && !permissionConnect) {
        try {
          val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
          val scanner = adapter?.bluetoothLeScanner
          if (scanner != null) {
            val callback = object : ScanCallback() {
              override fun onScanResult(callbackType: Int, result: ScanResult) {
                // Use a hashed radio identity internally; never expose the hardware address.
                val name = result.scanRecord?.deviceName ?: "Bluetooth LE device"
                val address = try { result.device.address } catch (_: SecurityException) { return }
                add(found, "bluetooth", address, name, "unknown",
                  "Bluetooth LE advertisement", signalDbm = result.rssi)
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

    // BLE and Classic inquiry run serially so the two radio scans do not compete.
    try { Thread.sleep(3500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    if (bluetoothScanner != null && bluetoothCallback != null) {
      try { bluetoothScanner.stopScan(bluetoothCallback) } catch (_: Exception) {}
    }
    val stopClassic = if (!permissionScan && !permissionConnect) BluetoothClassicDiscovery.start(context) {
      address, name, kind, source, paired, rssi ->
      add(found, source, address, name, kind,
        if (paired) "Paired Bluetooth" else "Bluetooth Classic", signalDbm = rssi, paired = paired,
        observedNow = source != "bluetooth-paired" || rssi != null)
    } else ({})
    try { Thread.sleep(if (permissionScan || permissionConnect) 8500 else 10500) }
    catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    stopClassic()
    for (listener in listeners) {
      try { nsd.stopServiceDiscovery(listener) } catch (_: Exception) {}
    }
    resolvers.shutdown()
    try { resolvers.awaitTermination(1400, TimeUnit.MILLISECONDS) }
    catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    resolvers.shutdownNow()
    try { ssdpWorker.join(300) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    try { lanWorker.join(1500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    val results = found.values.sortedWith(compareBy({ it.name.lowercase() }, { it.id })).take(350)
    recentBluetooth = results.filter { it.id.startsWith("bt-") }.associateBy { it.id }
    bluetoothScanAt = SystemClock.elapsedRealtime()
    return Scan(results, bluetoothPermissionRequired, lanScan.networkLabel, lanScan.limited)
  }

  /** Send targeted UPnP/DIAL discovery only. Do not fetch or follow untrusted LOCATION URLs. */
  private fun discoverSsdp(found: ConcurrentHashMap<String, Device>) {
    val targets = listOf(
      "urn:schemas-upnp-org:device:MediaRenderer:1",
      "urn:dial-multiscreen-org:service:dial:1",
      "urn:lge-com:service:webos-second-screen:1",
      "roku:ecp",
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
          val lgWebos = target.contains("webos-second-screen")
          val roku = target == "roku:ecp"
          if (!target.contains("mediarenderer") && !target.contains("dial") && !lgWebos && !roku) continue
          val usn = headers["usn"]?.take(160) ?: continue
          val server = clean(headers["server"] ?: "", 72)
          val name = if (lgWebos) "LG webOS TV"
            else if (roku) "Roku device"
            else if (server.isNotEmpty()) server
            else if (target.contains("dial")) "DIAL media device" else "UPnP media renderer"
          add(found, "ssdp", usn, name,
            if (lgWebos || target.contains("dial") || roku) "display" else "media",
            if (lgWebos) "LG webOS second screen" else if (roku) "Roku ECP discovery" else "UPnP / DIAL",
            ipAddress = packet.address.hostAddress,
            descriptionUrl = headers["location"]?.take(400))
        }
      }
    } catch (_: Exception) {
      // Local networks may block SSDP. mDNS and BLE remain available.
    }
  }
}
