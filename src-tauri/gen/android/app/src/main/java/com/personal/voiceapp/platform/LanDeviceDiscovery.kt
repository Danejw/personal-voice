package com.personal.voiceapp.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import androidx.core.content.ContextCompat

/**
 * Explicit, bounded read-only LAN discovery on the connected Wi-Fi interface.
 * No internet-wide scan, payload exchange, credentials or service control.
 * A wider-than-/24 subnet is limited to the /24 containing this phone.
 */
internal object LanDeviceDiscovery {
  data class Host(val ip: String, val kind: String, val ports: List<Int>)
  data class Scan(val devices: List<Host>, val networkLabel: String, val limited: Boolean)

  // Connect-only checks with short timeouts. Firewalls can hide live computers.
  private val ports = listOf(80, 443, 445, 22, 3389, 3001, 8001, 8002, 8008, 8060, 8080, 9100, 554)

  /** Pure target planner, tested without an Android device. */
  fun addresses(ip: String, prefix: Int): List<String> {
    if (prefix !in 1..30) return emptyList()
    val pieces = ip.split('.').mapNotNull { it.toIntOrNull()?.takeIf { part -> part in 0..255 } }
    if (pieces.size != 4) return emptyList()
    if (pieces[0] != 10 && pieces[0] != 192 && !(pieces[0] == 172 && pieces[1] in 16..31)) {
      return emptyList()
    }
    val n = pieces.fold(0L) { acc, value -> (acc shl 8) or value.toLong() }
    val scopedPrefix = maxOf(prefix, 24)
    val mask = (0xffffffffL shl (32 - scopedPrefix)) and 0xffffffffL
    val first = (n and mask) + 1
    val last = ((n and mask) or (mask.inv() and 0xffffffffL)) - 1
    return (first..last).asSequence().filter { it != n }.map { target ->
      listOf(24, 16, 8, 0).joinToString(".") { shift -> ((target ushr shift) and 255).toString() }
    }.take(254).toList()
  }

  fun scan(context: Context): Scan {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_NETWORK_STATE)
      != PackageManager.PERMISSION_GRANTED) return Scan(emptyList(), "Network status unavailable", false)
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val wifi = manager.allNetworks.firstOrNull { network ->
      manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    } ?: return Scan(emptyList(), "Connect to Wi-Fi to scan its LAN", false)
    val address = manager.getLinkProperties(wifi)?.linkAddresses
      ?.firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress }
      ?: return Scan(emptyList(), "No private IPv4 Wi-Fi subnet found", false)
    val localIp = address.address.hostAddress ?: return Scan(emptyList(), "Wi-Fi IP unavailable", false)
    val prefix = address.prefixLength
    val targets = addresses(localIp, prefix)
    if (targets.isEmpty()) return Scan(emptyList(), "No scannable private Wi-Fi subnet", false)

    val pool = Executors.newFixedThreadPool(32)
    try {
      val futures = pool.invokeAll(targets.map { ip ->
        Callable {
          val responding = mutableListOf<Int>()
          for (port in ports) {
            if (Thread.currentThread().isInterrupted) break
            try {
              wifi.socketFactory.createSocket().use { socket ->
                socket.connect(InetSocketAddress(ip, port), 110)
                responding.add(port)
              }
            } catch (_: Exception) { /* Closed / filtered, not evidence a device is absent. */ }
          }
          if (responding.isEmpty()) null else Host(ip, kind(responding), responding)
        }
      }, 13, TimeUnit.SECONDS)
      val found = futures.mapNotNull { future ->
        if (future.isCancelled) null else try { future.get() } catch (_: Exception) { null }
      }
      return Scan(found.sortedWith(compareBy { ipAsLong(it.ip) }),
        localIp + "/" + prefix + " · " + targets.size + " addresses checked", prefix < 24)
    } finally {
      pool.shutdownNow()
    }
  }

  private fun kind(ports: List<Int>): String = when {
    9100 in ports -> "printer"
    8008 in ports -> "media"
    3389 in ports || 445 in ports -> "computer"
    22 in ports -> "server"
    else -> "unknown"
  }

  private fun ipAsLong(ip: String): Long =
    ip.split('.').fold(0L) { acc, octet -> (acc shl 8) or (octet.toLongOrNull() ?: 0) }
}
