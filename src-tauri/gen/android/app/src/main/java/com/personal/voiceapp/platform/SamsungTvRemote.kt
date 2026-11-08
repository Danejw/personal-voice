package com.personal.voiceapp.platform

import android.content.Context
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/**
 * Opt-in Samsung Tizen remote over WSS port 8002.
 *
 * TVs normally use self-signed certificates. The first inspection only exposes its SHA-256
 * fingerprint. Explicit Pair pins that fingerprint and still requires the TV's on-screen
 * approval. Every subsequent handshake must match the stored pin: never a trust-all
 * WebSocket, never an unencrypted 8001 fallback, never control merely from SSDP metadata.
 */
internal object SamsungTvRemote {
  private const val PORT = 8002
  private const val MAX_WAIT_SECONDS = 29L
  private val keys = setOf(
    "KEY_HOME", "KEY_RETURN", "KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT",
    "KEY_ENTER", "KEY_VOLUP", "KEY_VOLDOWN", "KEY_MUTE",
    "KEY_PLAY", "KEY_PAUSE", "KEY_EXIT"
  )
  private data class Session(val webSocket: WebSocket, val fingerprint: String, val client: OkHttpClient)
  private val sessions = mutableMapOf<String, Session>()
  private val lock = Any()

  private fun sha256(data: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(data).joinToString("") {
      (it.toInt() and 255).toString(16).padStart(2, '0')
    }

  private fun trustManager(check: (Array<out X509Certificate>?) -> Unit): X509TrustManager =
    object : X509TrustManager {
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificates are not supported.")
      }
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        check(chain)
    }

  private fun ssl(factoryTrust: X509TrustManager): SSLSocketFactory =
    SSLContext.getInstance("TLS").apply {
      init(null, arrayOf(factoryTrust), SecureRandom())
    }.socketFactory

  /** Read a certificate only; no remote token or command is transmitted during inspection. */
  fun fingerprint(ip: String): String? {
    if (!LocalDeviceCapabilities.privateIp(ip)) return null
    return try {
      val probe = ssl(trustManager { chain ->
        if (chain.isNullOrEmpty()) throw CertificateException("Missing certificate.")
      })
      (probe.createSocket() as SSLSocket).use { socket ->
        socket.connect(InetSocketAddress(ip, PORT), 1300)
        socket.soTimeout = 1700
        socket.startHandshake()
        val cert = socket.session.peerCertificates.firstOrNull() as? X509Certificate
        cert?.let { sha256(it.encoded) }
      }
    } catch (_: Exception) { null }
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences("pv_samsung_tizen_remote", Context.MODE_PRIVATE)

  fun isPaired(context: Context, ip: String, fingerprint: String): Boolean =
    prefs(context).getString("pin:" + ip, null) == fingerprint

  fun isConnected(ip: String, fingerprint: String): Boolean =
    synchronized(lock) { sessions[ip]?.fingerprint == fingerprint }

  /** TV displays Allow / Deny on first pairing. Never claim success before it accepts. */
  fun pair(context: Context, ip: String, inspectedFingerprint: String): String {
    require(LocalDeviceCapabilities.privateIp(ip)) { "Invalid private LAN address." }
    val current = fingerprint(ip) ?: error("TV secure remote port is unavailable.")
    require(current == inspectedFingerprint) { "TV certificate changed. Identify it again." }
    val settings = prefs(context)
    val previousPin = settings.getString("pin:" + ip, null)
    require(previousPin == null || previousPin == current) {
      "TV identity changed. Forget its old pairing before trusting the new certificate."
    }

    synchronized(lock) { sessions.remove(ip)?.webSocket?.close(1000, "Reconnecting") }

    val pinned = trustManager { chain ->
      val received = chain?.firstOrNull()?.encoded ?: throw CertificateException("Missing certificate.")
      if (sha256(received) != current) throw CertificateException("TV TLS identity changed.")
    }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(ssl(pinned), pinned)
      .hostnameVerifier { host, _ -> host == ip } // IP exact + certificate pin above
      .connectTimeout(3, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .build()
    val name = Base64.encodeToString("Personal Voice".toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    val token = settings.getString("token:" + ip, "").orEmpty()
      .takeIf { it.matches(Regex("^[a-zA-Z0-9_-]{0,128}$")) }.orEmpty()
    val url = "wss://" + ip + ":" + PORT + "/api/v2/channels/samsung.remote.control?name=" +
      name + (if (token.isNotEmpty()) "&token=" + token else "")

    val latch = CountDownLatch(1)
    var connected = false
    var failure = "TV did not approve the remote connection."
    var newToken: String? = null
    val socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
      override fun onMessage(webSocket: WebSocket, text: String) {
        try {
          val reply = JSONObject(text.take(4096))
          when (reply.optString("event")) {
            "ms.channel.connect" -> {
              newToken = reply.optJSONObject("data")?.optString("token")?.take(128)
              connected = true
              latch.countDown()
            }
            "ms.channel.unauthorized" -> {
              failure = "TV rejected Personal Voice. Check the TV permission prompt."
              latch.countDown()
            }
          }
        } catch (_: Exception) { /* Ignore unrelated channel frames. */ }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        failure = "Could not connect to the TV remote: " + (t.message ?: "connection failed")
        synchronized(lock) { if (sessions[ip]?.webSocket === webSocket) sessions.remove(ip) }
        latch.countDown()
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        synchronized(lock) { if (sessions[ip]?.webSocket === webSocket) sessions.remove(ip) }
      }
    })
    if (!latch.await(MAX_WAIT_SECONDS, TimeUnit.SECONDS) || !connected) {
      socket.close(1000, "Pairing ended")
      client.dispatcher.executorService.shutdown()
      error(failure)
    }
    settings.edit().putString("pin:" + ip, current).apply()
    if (!newToken.isNullOrBlank()) {
      settings.edit().putString("token:" + ip, newToken).apply()
    }
    synchronized(lock) { sessions[ip] = Session(socket, current, client) }
    return "TV approved Personal Voice remote control."
  }

  fun sendKey(context: Context, ip: String, key: String): String {
    require(key in keys) { "Unsupported TV remote key." }
    val active = synchronized(lock) { sessions[ip] }
      ?: error("Connect the TV remote again to send commands.")
    require(isPaired(context, ip, active.fingerprint)) { "TV is not paired." }
    val current = fingerprint(ip) ?: error("TV is no longer reachable on its secure remote port.")
    require(current == active.fingerprint) { "TV certificate changed; remote control blocked." }
    val payload = JSONObject().put("method", "ms.remote.control")
      .put("params", JSONObject()
        .put("Cmd", "Click")
        .put("DataOfCmd", key)
        .put("Option", "false")
        .put("TypeOfRemote", "SendRemoteKey"))
      .toString()
    check(active.webSocket.send(payload)) { "TV remote connection is closed." }
    return "Remote key delivered to the TV connection; on-screen result is not verified."
  }

  fun forget(context: Context, ip: String) {
    synchronized(lock) {
      sessions.remove(ip)?.let {
        it.webSocket.close(1000, "Unpaired")
        it.client.dispatcher.executorService.shutdown()
      }
    }
    prefs(context).edit().remove("pin:" + ip).remove("token:" + ip).apply()
  }
}
