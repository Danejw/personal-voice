package com.personal.voiceapp.platform

import android.content.Context
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/**
 * Explicitly approved LG webOS TV control via encrypted SSAP (port 3001).
 * No plaintext fallback, arbitrary endpoints, implicit pairing or unverified successes.
 */
internal object LgWebOsRemote {
  private const val PORT = 3001
  private val lock = Any()
  private val sessions = mutableMapOf<String, Session>()
  private val actions = mapOf(
    "volume_up" to "ssap://audio/volumeUp",
    "volume_down" to "ssap://audio/volumeDown",
    "mute" to "ssap://audio/setMute",
    "unmute" to "ssap://audio/setMute",
    "play" to "ssap://media.controls/play",
    "pause" to "ssap://media.controls/pause",
    "show_message" to "ssap://system.notifications/createToast",
    "get_volume" to "ssap://audio/getVolume",
  )
  private val permissions = listOf(
    "CONTROL_AUDIO",
    "CONTROL_INPUT_MEDIA_PLAYBACK",
    "WRITE_NOTIFICATION_TOAST",
  )

  private class Pending {
    val done = CountDownLatch(1)
    val response = AtomicReference<JSONObject?>()
  }
  private class Session(
    val socket: WebSocket, val fingerprint: String, val client: OkHttpClient,
    val pending: java.util.concurrent.ConcurrentHashMap<String, Pending>,
  ) {
    val commandLock = Any()
  }

  private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
      (it.toInt() and 255).toString(16).padStart(2, '0')
    }

  private fun trustManager(verify: (Array<out X509Certificate>?) -> Unit): X509TrustManager =
    object : X509TrustManager {
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client certificate authentication is unsupported.")
      }
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        verify(chain)
    }

  private fun tls(trust: X509TrustManager): SSLSocketFactory =
    SSLContext.getInstance("TLS").apply {
      init(null, arrayOf(trust), SecureRandom())
    }.socketFactory

  /** Fingerprint inspection does not open a remote-control session or send commands. */
  fun fingerprint(ip: String): String? {
    if (!LocalDeviceCapabilities.privateIp(ip)) return null
    return try {
      val probe = tls(trustManager { chain ->
        if (chain.isNullOrEmpty()) throw CertificateException("Missing TLS certificate.")
      })
      (probe.createSocket() as SSLSocket).use { socket ->
        socket.connect(InetSocketAddress(ip, PORT), 1400)
        socket.soTimeout = 1900
        socket.startHandshake()
        val certificate = socket.session.peerCertificates.firstOrNull() as? X509Certificate
        certificate?.let { sha256(it.encoded) }
      }
    } catch (_: Exception) { null }
  }

  private fun settings(context: Context) =
    context.getSharedPreferences("pv_lg_webos_remote", Context.MODE_PRIVATE)

  fun isPaired(context: Context, ip: String, hash: String): Boolean =
    settings(context).getString("pin:" + ip, null) == hash &&
      !settings(context).getString("key:" + ip, null).isNullOrEmpty()

  fun supportedAction(action: String): Boolean = action in actions

  fun pair(context: Context, ip: String, inspectedFingerprint: String): String {
    require(LocalDeviceCapabilities.privateIp(ip)) { "Invalid private Wi-Fi address." }
    require(inspectedFingerprint.matches(Regex("[a-f0-9]{64}"))) {
      "Invalid TV certificate fingerprint."
    }
    val presented = fingerprint(ip) ?: error("LG TV secure remote port 3001 is unavailable.")
    require(presented == inspectedFingerprint) {
      "TV certificate changed. Identify this device again."
    }
    val prefs = settings(context)
    val previous = prefs.getString("pin:" + ip, null)
    require(previous == null || previous == presented) {
      "TV identity changed. Forget its old pairing first."
    }
    synchronized(lock) { close(sessions.remove(ip)) }

    val verified = trustManager { chain ->
      val bytes = chain?.firstOrNull()?.encoded ?: throw CertificateException("Missing certificate.")
      if (sha256(bytes) != presented) throw CertificateException("TV identity changed.")
    }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(tls(verified), verified)
      .hostnameVerifier { host, _ -> host == ip } // Exact-IP certificate pin above.
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .build()

    val previousKey = prefs.getString("key:" + ip, null)
      ?.takeIf { it.length in 1..256 && it.all { c -> c.isLetterOrDigit() || c in "-_=" } }
    val manifest = JSONObject()
      .put("manifestVersion", 1)
      .put("appVersion", "1.0")
      .put("permissions", JSONArray(permissions))
    val payload = JSONObject()
      .put("forcePairing", false)
      .put("pairingType", "PROMPT")
      .put("manifest", manifest)
    if (previousKey != null) payload.put("client-key", previousKey)

    val pending = java.util.concurrent.ConcurrentHashMap<String, Pending>()
    val registered = CountDownLatch(1)
    val receivedKey = AtomicReference<String?>()
    val pairFailure = AtomicReference("TV did not approve Personal Voice.")
    val ws = client.newWebSocket(Request.Builder()
      .url("wss://" + ip + ":" + PORT + "/").build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          val request = JSONObject()
            .put("id", "register_1").put("type", "register").put("payload", payload)
          if (!webSocket.send(request.toString())) {
            pairFailure.set("Could not send the TV pairing request.")
            registered.countDown()
          }
        }
        override fun onMessage(webSocket: WebSocket, text: String) {
          try {
            val data = JSONObject(text.take(8192))
            when (data.optString("type")) {
              "registered" -> {
                val key = data.optJSONObject("payload")?.optString("client-key")
                if (!key.isNullOrBlank() && key.length <= 256) {
                  receivedKey.set(key)
                } else {
                  pairFailure.set("TV did not return a pairing key.")
                }
                registered.countDown()
              }
              "error" -> {
                if (data.optString("id") == "register_1") {
                  pairFailure.set(data.optString("error", "TV rejected pairing.").take(180))
                  registered.countDown()
                } else {
                  pending.remove(data.optString("id"))?.let {
                    it.response.set(data); it.done.countDown()
                  }
                }
              }
              "response" -> {
                pending.remove(data.optString("id"))?.let {
                  it.response.set(data); it.done.countDown()
                }
              }
            }
          } catch (_: Exception) { /* Ignore unrelated or malformed TV frames. */ }
        }
        override fun onFailure(webSocket: WebSocket, cause: Throwable, response: Response?) {
          pairFailure.set("TV connection failed: " + (cause.message ?: "remote unavailable"))
          registered.countDown()
          synchronized(lock) {
            if (sessions[ip]?.socket === webSocket) sessions.remove(ip)
          }
        }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          synchronized(lock) {
            if (sessions[ip]?.socket === webSocket) sessions.remove(ip)
          }
        }
      })
    val key = if (registered.await(30, TimeUnit.SECONDS)) receivedKey.get() else null
    if (key == null) {
      ws.close(1000, "Pairing ended")
      client.dispatcher.executorService.shutdown()
      error(pairFailure.get())
    }
    prefs.edit().putString("pin:" + ip, presented).putString("key:" + ip, key).apply()
    synchronized(lock) { sessions[ip] = Session(ws, presented, client, pending) }
    return "LG TV approved Personal Voice."
  }

  fun action(context: Context, ip: String, action: String): String {
    val uri = actions[action] ?: error("Unsupported LG TV action.")
    val session = synchronized(lock) { sessions[ip] }
      ?: error("Connect the LG TV remote first.")
    require(isPaired(context, ip, session.fingerprint)) { "LG TV is not paired." }
    require(fingerprint(ip) == session.fingerprint) { "TV identity changed; control blocked." }

    synchronized(session.commandLock) {
      val id = "pv_lg_" + System.nanoTime()
      val wait = Pending()
      session.pending[id] = wait
      val message = JSONObject().put("type", "request").put("id", id).put("uri", uri)
      val payload = when (action) {
        "mute" -> JSONObject().put("mute", true)
        "unmute" -> JSONObject().put("mute", false)
        "show_message" -> JSONObject().put("message", "Hello from Personal Voice")
        else -> null
      }
      if (payload != null) message.put("payload", payload)
      try {
        check(session.socket.send(message.toString())) { "TV remote is disconnected." }
        require(wait.done.await(6, TimeUnit.SECONDS)) { "TV did not acknowledge the command." }
        val reply = wait.response.get() ?: error("TV response was missing.")
        if (reply.optString("type") == "error") {
          error("TV rejected the command: " + reply.optString("error", "Unknown error"))
        }
        val result = reply.optJSONObject("payload") ?: error("Invalid TV response.")
        require(result.optBoolean("returnValue", false)) {
          "TV rejected the command: " + result.optString("errorText", "unsupported request")
        }
        if (action == "get_volume") {
          val number = result.optInt("volume", -1)
          return if (number in 0..100) "TV volume: " + number else "TV volume response received."
        }
        return "TV confirmed " + action.replace('_', ' ') + "."
      } finally {
        session.pending.remove(id)
      }
    }
  }

  private fun close(session: Session?) {
    if (session == null) return
    session.socket.close(1000, "Disconnected")
    session.client.dispatcher.executorService.shutdown()
  }

  fun forget(context: Context, ip: String) {
    synchronized(lock) { close(sessions.remove(ip)) }
    settings(context).edit().remove("pin:" + ip).remove("key:" + ip).apply()
  }
}
