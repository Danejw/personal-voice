package com.personal.voiceapp.platform

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.SystemClock
import org.json.JSONObject
import org.w3c.dom.Element
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.URI
import java.net.Socket
import java.security.MessageDigest
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Evidence-backed, device-local actions. Never take an arbitrary URL or control endpoint
 * from the WebView. Scan evidence expires and every action rechecks the current Wi-Fi subnet.
 */
internal object LocalDeviceCapabilities {
  data class Service(val type: String, val uri: URI)
  data class Identity(
    val ip: String, val name: String, val manufacturer: String, val model: String,
    val features: List<String>, val webPort: Int?, val samsungFingerprint: String?,
    val lgFingerprint: String?,
  )

  private data class Record(
    val observedAt: Long, val ports: Set<Int>, val descriptions: List<URI>,
    val lgAnnounced: Boolean = false,
    val rokuAnnounced: Boolean = false,
    var identity: Identity? = null, var media: Map<String, Service> = emptyMap(),
  )
  private val known = java.util.concurrent.ConcurrentHashMap<String, Record>()
  private const val TTL = 180_000L
  private const val MAX_REPLY = 80_000

  fun privateIp(ip: String): Boolean {
    val octets = ip.split('.').mapNotNull { it.toIntOrNull()?.takeIf { number -> number in 0..255 } }
    if (octets.size != 4) return false
    return octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) ||
      (octets[0] == 192 && octets[1] == 168)
  }

  /** An SSDP location can only fetch from its packet's private-IP sender, never elsewhere. */
  fun safeLocation(raw: String?, senderIp: String): URI? {
    if (raw.isNullOrBlank() || raw.length > 400 || !privateIp(senderIp)) return null
    val uri = try { URI(raw) } catch (_: Exception) { return null }
    if (uri.scheme != "http" || uri.host != senderIp || uri.userInfo != null ||
      uri.fragment != null || uri.port > 65535 || uri.port == 0 ||
      uri.isOpaque || uri.rawPath.isNullOrBlank() || uri.rawPath.length > 240) return null
    return uri
  }

  /** Called only after an explicit Nearby scan, before its results cross the plugin boundary. */
  @Synchronized fun remember(devices: List<NearbyDeviceDiscovery.Device>) {
    val next = mutableMapOf<String, Pair<MutableSet<Int>, MutableList<URI>>>()
    val lgResponders = mutableSetOf<String>()
    val rokuResponders = mutableSetOf<String>()
    for (device in devices) {
      val ip = device.ipAddress ?: continue
      if (!privateIp(ip)) continue
      val pair = next.getOrPut(ip) { Pair(mutableSetOf(), mutableListOf()) }
      // DNS-SD advertises ports but does not prove they are reachable or safe
      // browser/control endpoints. Only a successfully connected LAN port counts.
      if (device.source == "lan") pair.first.addAll(device.ports)
      if (device.source == "ssdp" && device.detail == "LG webOS second screen") {
        lgResponders.add(ip)
      }
      if (device.source == "ssdp" && device.detail == "Roku ECP discovery") {
        rokuResponders.add(ip)
      }
      val safe = safeLocation(device.descriptionUrl, ip)
      if (safe != null && safe !in pair.second) pair.second.add(safe)
    }
    known.clear()
    val now = SystemClock.elapsedRealtime()
    for ((ip, evidence) in next) {
      known[ip] = Record(now, evidence.first.toSet(), evidence.second.take(4),
        lgAnnounced = ip in lgResponders, rokuAnnounced = ip in rokuResponders)
    }
  }

  private fun requireSeen(context: Context, ip: String): Record {
    val record = known[ip] ?: error("Scan this device again before using actions.")
    require(privateIp(ip) && SystemClock.elapsedRealtime() - record.observedAt in 0..TTL) {
      "Discovery expired. Scan the network again."
    }
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val wifiActive = cm.allNetworks.any { network ->
      cm.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
        cm.getLinkProperties(network)?.linkAddresses?.any { address ->
          val local = address.address
          local is Inet4Address && local.isSiteLocalAddress &&
            LanDeviceDiscovery.addresses(local.hostAddress ?: "", address.prefixLength).contains(ip)
        } == true
    }
    require(wifiActive) { "Device is no longer on the current Wi-Fi subnet." }
    return record
  }

  fun inspect(context: Context, ip: String): Identity {
    val record = requireSeen(context, ip)
    var name = "Device " + ip
    var manufacturer = ""
    var model = ""
    var media = emptyMap<String, Service>()

    for (location in record.descriptions) {
      try {
        val xml = http(ip, location.port.takeIf { it != -1 } ?: 80,
          location.rawPath + (location.rawQuery?.let { "?" + it } ?: ""), null)
        val document = parseXml(xml.body)
        val device = document.documentElement.getElementsByTagNameNS("*", "device").item(0) as? Element
          ?: continue
        name = field(device, "friendlyName").ifBlank { name }.take(72)
        manufacturer = field(device, "manufacturer").take(64)
        model = field(device, "modelName").take(64)
        val candidates = mutableMapOf<String, Service>()
        val services = device.getElementsByTagNameNS("*", "service")
        for (i in 0 until services.length.coerceAtMost(25)) {
          val element = services.item(i) as? Element ?: continue
          val type = field(element, "serviceType")
          val key = when {
            type.matches(Regex("^urn:schemas-upnp-org:service:RenderingControl:[0-9]{1,3}$")) -> "volume"
            type.matches(Regex("^urn:schemas-upnp-org:service:AVTransport:[0-9]{1,3}$")) -> "playback"
            else -> continue
          }
          val rawControl = field(element, "controlURL")
          if (rawControl.isBlank()) continue
          val actionUrl = location.resolve(rawControl)
          if (actionUrl.scheme != "http" || actionUrl.host != ip ||
            actionUrl.userInfo != null || actionUrl.fragment != null ||
            actionUrl.rawPath.isNullOrBlank() || actionUrl.rawPath.length > 240 ||
            actionUrl.port == 0 || actionUrl.port > 65535) continue
          candidates[key] = Service(type.take(100), actionUrl)
        }
        media = candidates
        break
      } catch (_: Exception) {
        // Non-conforming UPnP advertisements are not promoted to capabilities.
      }
    }

    // A Samsung device-info response can identify a TV even when multicast is blocked.
    // It is still self-reported network evidence, not authorization to control it.
    if (8001 in record.ports) {
      try {
        val api = JSONObject(http(ip, 8001, "/api/v2/", null).body)
        val device = api.optJSONObject("device")
        if (device?.optString("type") == "Samsung SmartTV") {
          manufacturer = "Samsung"
          name = device.optString("name", name).take(72)
          model = device.optString("modelName", model).take(64)
        }
      } catch (_: Exception) { /* An open port alone proves nothing about TV identity. */ }
    }

    if (record.rokuAnnounced && manufacturer.isBlank()) {
      manufacturer = "Roku"
      name = "Roku device"
    }
    if (record.lgAnnounced && manufacturer.isBlank()) {
      manufacturer = "LG"
      name = "LG webOS TV"
    }

    // A port response is evidence of a reachable website, not proof of an admin interface.
    val webPort = listOf(443, 80, 8080).firstOrNull { it in record.ports }
    val fingerprint = if (manufacturer.contains("samsung", ignoreCase = true))
      SamsungTvRemote.fingerprint(ip) else null
    val lgFingerprint = when {
      record.lgAnnounced -> LgWebOsRemote.fingerprint(ip)
      manufacturer.contains("LG", ignoreCase = true) && 3001 in record.ports ->
        LgWebOsRemote.fingerprint(ip)
      3001 in record.ports -> LgWebOsRemote.probeWebOs(ip)
      else -> null
    }
    if (lgFingerprint != null && manufacturer.isBlank()) {
      manufacturer = "LG"
      name = "LG webOS TV"
    }
    val features = buildList {
      if (webPort != null) add("open_web")
      if (media.containsKey("volume")) add("volume")
      if (media.containsKey("playback")) add("playback")
      if (fingerprint != null) add("samsung_remote")
      if (lgFingerprint != null) add("lg_remote")
      // Safe handoff to Roku's official mobile remote. Roku's published
      // policy does not allow third-party mobile ECP commands.
      if (record.rokuAnnounced || 8060 in record.ports) add("roku_companion")
    }
    val identity = Identity(ip, name, manufacturer, model, features, webPort, fingerprint,
      lgFingerprint)
    record.identity = identity
    record.media = media
    return identity
  }

  fun pairLg(context: Context, ip: String, fingerprint: String): String {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require("lg_remote" in identity.features && identity.lgFingerprint == fingerprint) {
      "An LG webOS remote was not verified for this device."
    }
    return LgWebOsRemote.pair(context, ip, fingerprint)
  }

  fun lgAction(context: Context, ip: String, action: String): String {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require("lg_remote" in identity.features && LgWebOsRemote.supportedAction(action)) {
      "LG TV action is not available for this device."
    }
    return LgWebOsRemote.action(context, ip, action)
  }

  fun forgetLg(context: Context, ip: String) {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require("lg_remote" in identity.features) { "LG TV remote is not verified." }
    LgWebOsRemote.forget(context, ip)
  }

  fun lgPaired(context: Context, ip: String, fingerprint: String): Boolean =
    LgWebOsRemote.isPaired(context, ip, fingerprint)

  fun pairSamsung(context: Context, ip: String, fingerprint: String): String {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require("samsung_remote" in identity.features && identity.samsungFingerprint == fingerprint) {
      "Samsung remote control was not verified for this device."
    }
    return SamsungTvRemote.pair(context, ip, fingerprint)
  }

  fun samsungKey(context: Context, ip: String, key: String): String {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require("samsung_remote" in identity.features) { "Samsung remote is unavailable." }
    return SamsungTvRemote.sendKey(context, ip, key)
  }

  fun forgetSamsung(context: Context, ip: String) {
    val identity = requireSeen(context, ip).identity ?: error("Identify the TV first.")
    require(identity.manufacturer.contains("samsung", ignoreCase = true)) {
      "This is not an identified Samsung TV."
    }
    SamsungTvRemote.forget(context, ip)
  }

  fun samsungPaired(context: Context, ip: String, fingerprint: String): Boolean =
    SamsungTvRemote.isPaired(context, ip, fingerprint)

  fun openRokuApp(context: Context, ip: String): Intent {
    val identity = requireSeen(context, ip).identity ?: error("Identify the Roku first.")
    require("roku_companion" in identity.features) { "Roku has not been verified on this network." }
    return Intent(Intent.ACTION_VIEW,
      Uri.parse("https://play.google.com/store/apps/details?id=com.roku.remote"))
      .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  fun openWeb(context: Context, ip: String): Intent {
    val identity = requireSeen(context, ip).identity ?: error("Identify the device first.")
    val port = identity.webPort ?: error("No verified web port is available.")
    val protocol = if (port == 443) "https" else "http"
    return Intent(Intent.ACTION_VIEW, Uri.parse(protocol + "://" + ip + ":" + port + "/"))
      .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  fun mediaAction(context: Context, ip: String, action: String): String {
    val record = requireSeen(context, ip)
    require(record.identity != null) { "Identify this device first." }
    val volume = action == "volume_up" || action == "volume_down"
    val service = record.media[if (volume) "volume" else "playback"]
      ?: error("This device does not advertise that control.")
    val target = service.uri
    if (target.host != ip || target.scheme != "http") error("Unsafe control endpoint.")
    val port = target.port.takeIf { it > 0 } ?: 80
    val path = target.rawPath + (target.rawQuery?.let { "?" + it } ?: "")
    val desiredAction: String
    val args: String
    when (action) {
      "volume_up", "volume_down" -> {
        val response = soap(ip, port, path, service, "GetVolume",
          "<InstanceID>0</InstanceID><Channel>Master</Channel>")
        val current = field(parseXml(response), "CurrentVolume").toIntOrNull()
          ?: error("Device did not return its volume.")
        val targetVolume = (current + if (action == "volume_up") 5 else -5).coerceIn(0, 100)
        desiredAction = "SetVolume"
        args = "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" +
          targetVolume + "</DesiredVolume>"
      }
      "play" -> {
        desiredAction = "Play"
        args = "<InstanceID>0</InstanceID><Speed>1</Speed>"
      }
      "pause" -> {
        desiredAction = "Pause"
        args = "<InstanceID>0</InstanceID>"
      }
      else -> error("Unsupported device action.")
    }
    soap(ip, port, path, service, desiredAction, args)
    return if (volume) "Volume command accepted by device." else
      "Playback command accepted by device."
  }

  private fun soap(ip: String, port: Int, path: String, service: Service, action: String, args: String): String {
    val body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
      "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
      "<s:Body><u:" + action + " xmlns:u=\"" + service.type + "\">" + args +
      "</u:" + action + "></s:Body></s:Envelope>"
    return http(ip, port, path, body, service.type + "#" + action).body
  }

  private data class HttpReply(val body: String)

  /** Small raw HTTP request for a private-IP peer only; release builds forbid global cleartext. */
  private fun http(ip: String, port: Int, path: String, postBody: String?, soapAction: String? = null): HttpReply {
    require(privateIp(ip) && port in 1..65535 && path.startsWith("/") &&
      path.length <= 300 && '\r' !in path && '\n' !in path) { "Unsafe local URL." }
    Socket().use { socket ->
      socket.connect(InetSocketAddress(ip, port), 1400)
      socket.soTimeout = 1600
      val method = if (postBody == null) "GET" else "POST"
      val bodyBytes = postBody?.toByteArray(Charsets.UTF_8)
      val headers = StringBuilder()
        .append(method).append(" ").append(path).append(" HTTP/1.1\r\n")
        .append("Host: ").append(ip).append(":").append(port).append("\r\n")
        .append("Connection: close\r\n")
        .append("Accept: text/xml, application/xml, */*\r\n")
      if (bodyBytes != null) {
        headers.append("Content-Type: text/xml; charset=\"utf-8\"\r\n")
          .append("SOAPAction: \"").append(soapAction).append("\"\r\n")
          .append("Content-Length: ").append(bodyBytes.size).append("\r\n")
      }
      headers.append("\r\n")
      val stream = socket.getOutputStream()
      stream.write(headers.toString().toByteArray(Charsets.US_ASCII))
      if (bodyBytes != null) stream.write(bodyBytes)
      stream.flush()
      val buffer = ByteArray(4096)
      val out = ByteArrayOutputStream()
      while (out.size() < MAX_REPLY) {
        val count = try { socket.getInputStream().read(buffer) }
          catch (_: java.net.SocketTimeoutException) { break }
        if (count <= 0) break
        out.write(buffer, 0, minOf(count, MAX_REPLY - out.size()))
      }
      val raw = out.toString("UTF-8")
      val split = raw.indexOf("\r\n\r\n")
      require(split in 12..8192) { "Invalid local HTTP response." }
      val header = raw.substring(0, split)
      require(header.startsWith("HTTP/1.1 200") || header.startsWith("HTTP/1.0 200")) {
        "Device rejected the request (" + header.lineSequence().first().take(55) + ")."
      }
      val body = raw.substring(split + 4)
      return HttpReply(if (header.contains("transfer-encoding: chunked", true))
        decodeChunked(body) else body)
    }
  }

  /** Bounded decoder for HTTP/1.1 chunked UPnP device descriptions. */
  private fun decodeChunked(body: String): String {
    var cursor = 0
    val out = StringBuilder()
    while (cursor < body.length && out.length < MAX_REPLY) {
      val lineEnd = body.indexOf("\r\n", cursor)
      require(lineEnd in cursor..(cursor + 32).coerceAtMost(body.length)) {
        "Invalid HTTP chunk framing."
      }
      val size = body.substring(cursor, lineEnd).substringBefore(";").trim()
        .toIntOrNull(16) ?: error("Invalid HTTP chunk size.")
      require(size in 0..MAX_REPLY && out.length + size <= MAX_REPLY) {
        "Oversized HTTP chunk."
      }
      if (size == 0) return out.toString()
      val first = lineEnd + 2
      require(first + size + 2 <= body.length && body.startsWith("\r\n", first + size)) {
        "Incomplete HTTP chunk."
      }
      out.append(body, first, first + size)
      cursor = first + size + 2
    }
    error("Incomplete HTTP chunked response.")
  }

  private fun parseXml(xml: String): org.w3c.dom.Document {
    require(xml.length <= MAX_REPLY) { "Oversized device response." }
    val f = DocumentBuilderFactory.newInstance()
    f.isNamespaceAware = true
    f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    f.setFeature("http://xml.org/sax/features/external-general-entities", false)
    f.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
    f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
    f.isXIncludeAware = false
    f.setExpandEntityReferences(false)
    return f.newDocumentBuilder().parse(xml.byteInputStream(Charsets.UTF_8))
  }

  private fun field(element: Element, local: String): String =
    element.getElementsByTagNameNS("*", local).item(0)?.textContent?.trim().orEmpty().take(160)

  private fun field(document: org.w3c.dom.Document, local: String): String =
    document.getElementsByTagNameNS("*", local).item(0)?.textContent?.trim().orEmpty().take(160)
}
