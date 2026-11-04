package com.personal.voiceapp.platform

import android.util.Base64
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean

/** Local Wi-Fi transport only. The Java socket never receives plaintext commands:
 * JS verifies paired identities and decrypts AES-GCM DeviceLink envelopes.
 */
internal object DeviceLinkNetwork {
  internal data class Peer(val deviceId: String, val host: String, val port: Int)
  private val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

  fun privateHost(ip: InetAddress): Boolean {
    if (ip.isLoopbackAddress || ip.isLinkLocalAddress || ip.isSiteLocalAddress) return true
    return false
  }

  fun parseAnnouncement(text: String, sourceIp: InetAddress): Peer? {
    if (!privateHost(sourceIp)) return null
    val parts = text.split(":")
    if (parts.size != 3 || parts[0] != "PV-DL1" || !uuid.matches(parts[1])) return null
    val port = parts[2].toIntOrNull() ?: return null
    if (port !in 1024..65535) return null
    return Peer(parts[1].lowercase(), sourceIp.hostAddress ?: return null, port)
  }

  /** Broadcast to each active IPv4 LAN interface; response is only a host locator. */
  fun discover(timeoutMs: Int = 1800): List<Peer> {
    val result = linkedMapOf<String, Peer>()
    val socket = DatagramSocket().apply {
      broadcast = true
      soTimeout = 200
    }
    try {
      val targetPorts = mutableSetOf<InetAddress>()
      targetPorts.add(InetAddress.getByName("255.255.255.255"))
      val interfaces = NetworkInterface.getNetworkInterfaces()
      while (interfaces.hasMoreElements()) {
        val iface = interfaces.nextElement()
        if (!iface.isUp || iface.isLoopback) continue
        for (address in iface.interfaceAddresses) {
          if (address.address is Inet4Address && address.broadcast != null) {
            targetPorts.add(address.broadcast)
          }
        }
      }
      val query = "PV-DL1:DISCOVER".toByteArray(Charsets.US_ASCII)
      for (address in targetPorts) {
        try {
          socket.send(DatagramPacket(query, query.size, address, 39047))
        } catch (_: Exception) { /* Skip restricted interfaces. */ }
      }
      val until = System.currentTimeMillis() + timeoutMs.coerceIn(500, 4000)
      val response = ByteArray(160)
      while (System.currentTimeMillis() < until) {
        try {
          val packet = DatagramPacket(response, response.size)
          socket.receive(packet)
          val text = String(packet.data, packet.offset, packet.length, Charsets.US_ASCII)
          parseAnnouncement(text, packet.address)?.let { result[it.deviceId] = it }
        } catch (_: SocketTimeoutException) {}
      }
    } finally {
      socket.close()
    }
    return result.values.toList()
  }

  private fun encodeBase64(value: ByteArray): String =
    Base64.encodeToString(value, Base64.NO_WRAP)

  /** An RFC6455 websocket over a native LAN-only socket. */
  class WebSocketClient(
    private val host: String,
    private val port: Int,
    private val onOpen: () -> Unit,
    private val onText: (String) -> Unit,
    private val onClose: () -> Unit,
  ) {
    private val alive = AtomicBoolean(false)
    private val random = SecureRandom()
    private var socket: Socket? = null
    private var output: BufferedOutputStream? = null

    fun connect() {
      require(port in 1024..65535)
      val address = InetAddress.getByName(host)
      require(address is Inet4Address && privateHost(address)) { "DeviceLink only supports local network addresses." }
      if (!alive.compareAndSet(false, true)) return
      Thread {
        try {
          val connection = Socket()
          socket = connection
          connection.connect(java.net.InetSocketAddress(address, port), 3000)
          connection.soTimeout = 5000
          val input = BufferedInputStream(connection.getInputStream())
          val writer = BufferedOutputStream(connection.getOutputStream())
          output = writer
          val keyBytes = ByteArray(16).also(random::nextBytes)
          val key = encodeBase64(keyBytes)
          synchronized(writer) {
            writer.write(("GET /device-link HTTP/1.1\r\nHost: $host:$port\r\n" +
              "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
              "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: $key\r\n\r\n")
              .toByteArray(Charsets.US_ASCII))
            writer.flush()
          }
          val headers = ByteArrayOutputStream()
          while (headers.size() < 4096) {
            val b = input.read()
            if (b < 0) error("Connection closed before handshake.")
            headers.write(b)
            if (headers.toByteArray().takeLast(4) == listOf(13.toByte(),10.toByte(),13.toByte(),10.toByte())) break
          }
          val received = headers.toString("US-ASCII")
          val expected = encodeBase64(MessageDigest.getInstance("SHA-1")
            .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.US_ASCII)))
          require(received.startsWith("HTTP/1.1 101 ") && received.contains("Sec-WebSocket-Accept: $expected\r\n", ignoreCase = true)) {
            "Local websocket handshake was rejected."
          }
          connection.soTimeout = 0
          if (!alive.get()) return@Thread
          onOpen()
          while (alive.get()) {
            val first = input.read()
            val second = input.read()
            if (first < 0 || second < 0) break
            val opcode = first and 0x0f
            if (first and 0x80 == 0 || first and 0x70 != 0 || second and 0x80 != 0) break
            val length = when (second and 127) {
              in 0..125 -> second and 127
              126 -> (input.read() shl 8) or input.read()
              else -> break
            }
            if (length > 16_384 || length < 0) break
            val data = input.readNBytes(length)
            if (data.size != length) break
            if (opcode == 8) break
            if (opcode == 1) onText(String(data, Charsets.UTF_8))
            if (opcode != 1 && opcode != 10 && opcode != 9) break
          }
        } catch (_: Exception) {
          // UI receives only disconnected; sockets and pairing codes are never logged.
        } finally {
          close()
        }
      }.start()
    }

    fun send(text: String) {
      val data = text.toByteArray(Charsets.UTF_8)
      require(data.size <= 16_384) { "DeviceLink message too large." }
      require(alive.get()) { "DeviceLink is disconnected." }
      val writer = output ?: error("DeviceLink is not connected.")
      val mask = ByteArray(4).also(random::nextBytes)
      val frame = ByteArrayOutputStream().apply {
        write(0x81)
        if (data.size < 126) write(0x80 or data.size)
        else {
          write(0xfe)
          write((data.size ushr 8) and 255)
          write(data.size and 255)
        }
        write(mask)
        for (i in data.indices) write(data[i].toInt() xor mask[i % 4].toInt())
      }.toByteArray()
      synchronized(writer) {
        writer.write(frame)
        writer.flush()
      }
    }

    fun close() {
      if (!alive.compareAndSet(true, false)) return
      try { socket?.close() } catch (_: Exception) {}
      output = null
      socket = null
      onClose()
    }
  }
}
