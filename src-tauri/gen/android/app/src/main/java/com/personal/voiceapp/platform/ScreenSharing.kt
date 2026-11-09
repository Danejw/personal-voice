package com.personal.voiceapp.platform

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Screen sharing is opt-in and LAN-only. The TV must open the shown URL in a browser that
 * accepts multipart MJPEG. There is NO automatic TV casting, no cloud relay and no WebRTC.
 * Browser media transport is plain HTTP, so use a trusted private Wi-Fi network only.
 */
internal object ScreenSharing {
  private val main = Handler(Looper.getMainLooper())
  private var waiting: ((String?, String?) -> Unit)? = null
  private var address: String? = null
  private val consentFence = ScreenShareConsentFence()
  const val REQUEST_ID = "shareRequestId"
  @Synchronized fun isCurrent(requestId: Long): Boolean = consentFence.isCurrent(requestId)
  /** Only tracks delivery to an HTTP browser, never asserts it is a specific TV. */
  data class Delivery(val browserConnected: Boolean, val framesWritten: Long, val frameAgeMs: Long?)
  @Volatile private var observer: (() -> Delivery)? = null

  @Synchronized fun delivery(): Delivery =
    if (address == null) Delivery(false, 0, null)
    else observer?.invoke() ?: Delivery(false, 0, null)

  @Synchronized fun monitor(requestId: Long, source: (() -> Delivery)?) {
    if (consentFence.isCurrent(requestId)) observer = source
  }

  @Synchronized fun start(activity: Activity, finished: (String?, String?) -> Unit) {
    if (waiting != null || address != null) {
      finished(null, "Stop the current screen share before starting another.")
      return
    }
    val requestId = consentFence.begin()
    waiting = finished
    try {
      activity.startActivity(Intent(activity, ScreenShareConsentActivity::class.java)
        .putExtra(REQUEST_ID, requestId))
    } catch (error: Exception) {
      failed("Cannot open Android screen sharing permission.", requestId)
    }
  }

  @Synchronized fun consent(context: Context, code: Int, data: Intent?, requestId: Long) {
    if (!consentFence.isCurrent(requestId) || waiting == null) return
    if (code != Activity.RESULT_OK || data == null) {
      failed("Screen sharing was cancelled.", requestId)
      return
    }
    try {
      val intent = Intent(context, ScreenShareService::class.java)
        .putExtra(ScreenShareService.EXTRA_RESULT, code)
        .putExtra(ScreenShareService.EXTRA_DATA, data)
        .putExtra(REQUEST_ID, requestId)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    } catch (_: Exception) {
      failed("Could not start the screen sharing service.", requestId)
    }
  }

  @Synchronized fun currentUrl(): String? = address

  fun connected(url: String, requestId: Long): Boolean {
    val complete: ((String?, String?) -> Unit)?
    synchronized(this) {
      if (!consentFence.isCurrent(requestId) || waiting == null) return false
      address = url
      complete = waiting
      waiting = null
    }
    complete?.let { main.post { it(url, null) } }
    return true
  }

  fun failed(reason: String, requestId: Long? = null) {
    val complete: ((String?, String?) -> Unit)?
    synchronized(this) {
      if (requestId != null && !consentFence.isCurrent(requestId)) return
      address = null
      complete = waiting
      waiting = null
    }
    complete?.let { main.post { it(null, reason) } }
  }

  @Synchronized fun closed(requestId: Long) {
    if (!consentFence.isCurrent(requestId)) return
    address = null
    observer = null
  }

  fun stop(context: Context) {
    // Invalidate first, before the OS can deliver a stale permission result or queued service.
    synchronized(this) {
      consentFence.revoke()
      observer = null
    }
    context.stopService(Intent(context, ScreenShareService::class.java))
    failed("Screen sharing stopped.")
  }
}

/** Separate visible Android consent is required for every new MediaProjection session. */
class ScreenShareConsentActivity : Activity() {
  private var requestId = 0L
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    requestId = savedInstanceState?.getLong(ScreenSharing.REQUEST_ID)
      ?: intent.getLongExtra(ScreenSharing.REQUEST_ID, 0L)
    if (!ScreenSharing.isCurrent(requestId)) {
      finish()
      return
    }
    try {
      val manager = getSystemService(MediaProjectionManager::class.java)
      @Suppress("DEPRECATION")
      startActivityForResult(manager.createScreenCaptureIntent(), REQUEST)
    } catch (_: Exception) {
      ScreenSharing.failed("Android screen sharing is not available.", requestId)
      finish()
    }
  }

  override fun onSaveInstanceState(outState: android.os.Bundle) {
    outState.putLong(ScreenSharing.REQUEST_ID, requestId)
    super.onSaveInstanceState(outState)
  }

  @Deprecated("Android's MediaProjection consent still returns through onActivityResult.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQUEST) ScreenSharing.consent(this, resultCode, data, requestId)
    finish()
  }

  private companion object { const val REQUEST = 1804 }
}

/** Capture up to four JPEG frames/second for a single browser viewer on the same local Wi-Fi. */
class ScreenShareService : Service() {
  private val running = AtomicBoolean(false)
  private val viewer = AtomicBoolean(false)
  private val latestFrame = AtomicReference<ByteArray>()
  private val frameSequence = AtomicLong(0)
  private val framesWritten = AtomicLong(0)
  private val lastWrittenAt = AtomicLong(0)
  private var projection: MediaProjection? = null
  private var projectionCallback: MediaProjection.Callback? = null
  private var display: VirtualDisplay? = null
  private var reader: ImageReader? = null
  private var encoderThread: HandlerThread? = null
  private var listener: ServerSocket? = null
  private var acceptThread: Thread? = null
  private var client: Socket? = null
  private var lastFrameAt = 0L
  private var token = ""
  private var captureRequestId = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      ScreenSharing.stop(this)
      stopSelf()
      return START_NOT_STICKY
    }
    if (running.get()) return START_NOT_STICKY
    val requestId = intent?.getLongExtra(ScreenSharing.REQUEST_ID, 0L) ?: 0L
    if (!ScreenSharing.isCurrent(requestId)) {
      stopSelf()
      return START_NOT_STICKY
    }
    captureRequestId = requestId
    val code = intent?.getIntExtra(EXTRA_RESULT, Activity.RESULT_CANCELED)
      ?: Activity.RESULT_CANCELED
    val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
      intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
    else {
      @Suppress("DEPRECATION")
      intent?.getParcelableExtra(EXTRA_DATA)
    }
    if (code != Activity.RESULT_OK || data == null) {
      ScreenSharing.failed("A fresh screen sharing permission is required.", requestId)
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      } else startForeground(NOTIFICATION_ID, notification())
      openShare(code, data, requestId)
    } catch (error: Exception) {
      ScreenSharing.failed("Screen sharing could not start: " + (error.message ?: "unknown error"), requestId)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun openShare(code: Int, data: Intent, requestId: Long) {
    if (!ScreenSharing.isCurrent(requestId)) {
      stopSelf()
      return
    }
    val ip = wifiIp() ?: error("Connect phone and TV to the same private Wi-Fi network.")
    // Bind to Wi-Fi only. Never listen on a cellular or public interface.
    val server = ServerSocket(0, 2, ip)
    listener = server
    val bytes = ByteArray(12)
    SecureRandom().nextBytes(bytes)
    token = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

    val manager = getSystemService(MediaProjectionManager::class.java)
    val active = manager.getMediaProjection(code, data)
      ?: error("Android did not grant screen capture.")
    projection = active
    running.set(true)
    val callback = object : MediaProjection.Callback() {
      override fun onStop() { stopSelf() }
    }
    projectionCallback = callback
    active.registerCallback(callback, Handler(Looper.getMainLooper()))

    val metrics = resources.displayMetrics
    val width = metrics.widthPixels.coerceAtLeast(1)
    val height = metrics.heightPixels.coerceAtLeast(1)
    // This is a low-bandwidth preview, not full-motion gaming or video casting.
    val longest = maxOf(width, height)
    val scale = minOf(1.0, 1024.0 / longest)
    val w = (width * scale).toInt().coerceAtLeast(1)
    val h = (height * scale).toInt().coerceAtLeast(1)

    val thread = HandlerThread("screen-sharing-encoder").also { it.start() }
    encoderThread = thread
    val frames = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
    reader = frames
    frames.setOnImageAvailableListener({ imageReader ->
      val image = try { imageReader.acquireLatestImage() } catch (_: Exception) { null }
      if (image != null) {
        try {
          val now = SystemClock.elapsedRealtime()
          if (running.get() && now - lastFrameAt >= FRAME_INTERVAL_MS) {
            lastFrameAt = now
            latestFrame.set(encodeJpeg(image))
            frameSequence.incrementAndGet()
          }
        } catch (_: Exception) { /* Protected content and inaccessible frames stay blank. */ }
        finally { image.close() }
      }
    }, Handler(thread.looper))
    display = active.createVirtualDisplay(
      "personal-voice-screen-share",
      w, h, metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      frames.surface, null, Handler(Looper.getMainLooper()),
    )
    acceptThread = Thread({ acceptLoop(server, ip) }, "screen-sharing-server").also {
      it.isDaemon = true
      it.start()
    }
    ScreenSharing.monitor(requestId) {
      val age = lastWrittenAt.get().takeIf { it > 0 }
        ?.let { (SystemClock.elapsedRealtime() - it).coerceAtLeast(0) }
      ScreenSharing.Delivery(
        browserConnected = viewer.get() && running.get(),
        framesWritten = framesWritten.get(),
        frameAgeMs = age,
      )
    }
    if (!ScreenSharing.connected("http://" + ip.hostAddress + ":" + server.localPort +
        "/watch/" + token, requestId)) stopSelf()
  }

  private fun wifiIp(): Inet4Address? {
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.allNetworks.firstOrNull {
      manager.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    } ?: return null
    return manager.getLinkProperties(network)?.linkAddresses
      ?.mapNotNull { it.address as? Inet4Address }
      ?.firstOrNull { it.isSiteLocalAddress }
  }

  private fun inSameSubnet(remote: InetAddress, local: Inet4Address): Boolean {
    val other = remote as? Inet4Address ?: return false
    // Restrict the share to the phone's currently selected private Wi-Fi /24.
    return other.address.take(3) == local.address.take(3)
  }

  private fun acceptLoop(server: ServerSocket, local: Inet4Address) {
    while (running.get() && !server.isClosed) {
      val socket = try { server.accept() } catch (_: Exception) { break }
      if (!inSameSubnet(socket.inetAddress, local)) {
        try { socket.close() } catch (_: Exception) {}
        continue
      }
      Thread({ handleClient(socket) }, "screen-sharing-viewer").also {
        it.isDaemon = true
        it.start()
      }
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use {
      try {
        it.soTimeout = 8_000
        val input = it.getInputStream()
        val output = it.getOutputStream()
        val header = ByteArrayOutputStream()
        while (header.size() < 4096) {
          val n = input.read()
          if (n < 0) return
          header.write(n)
          if (header.size() >= 4) {
            val bytes = header.toByteArray()
            if (bytes.takeLast(4) == listOf(13.toByte(), 10.toByte(), 13.toByte(), 10.toByte())) break
          }
        }
        val request = header.toString(Charsets.US_ASCII.name()).lineSequence().firstOrNull() ?: return
        val route = request.split(" ")
        if (route.size < 3 || route[0] != "GET") {
          response(output, 405, "Method Not Allowed", "Method not allowed")
          return
        }
        when (route[1]) {
          "/watch/" + token -> {
            val body = """
              <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Personal Voice screen</title><style>
              html,body{margin:0;width:100%;height:100%;background:#080808;color:#ddd}
              img{display:block;width:100vw;height:100vh;object-fit:contain}
              </style></head><body><img alt="Live Personal Voice screen" src="/stream/$token"></body></html>
            """.trimIndent().toByteArray(Charsets.UTF_8)
            output.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
              "Cache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'\r\n" +
              "X-Content-Type-Options: nosniff\r\nContent-Length: " + body.size + "\r\nConnection: close\r\n\r\n")
              .toByteArray(Charsets.US_ASCII))
            output.write(body)
            output.flush()
          }
          "/stream/" + token -> {
            if (!viewer.compareAndSet(false, true)) {
              response(output, 409, "Conflict", "A viewer is already connected")
              return
            }
            client = socket
            try { stream(output) } finally { viewer.set(false); client = null }
          }
          else -> response(output, 404, "Not Found", "Screen sharing link is invalid")
        }
      } catch (_: Exception) { /* Browser closed or network changed. */ }
    }
  }

  private fun stream(out: java.io.OutputStream) {
    out.write(("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=pvframe\r\n" +
      "Cache-Control: no-store, no-cache\r\nX-Content-Type-Options: nosniff\r\n" +
      "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
    out.flush()
    var last = -1L
    while (running.get()) {
      val current = frameSequence.get()
      val bytes = latestFrame.get()
      if (bytes != null && current != last) {
        last = current
        out.write(("--pvframe\r\nContent-Type: image/jpeg\r\nContent-Length: " +
          bytes.size + "\r\n\r\n").toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.write("\r\n".toByteArray(Charsets.US_ASCII))
        out.flush()
        framesWritten.incrementAndGet()
        lastWrittenAt.set(SystemClock.elapsedRealtime())
      }
      try { Thread.sleep(100) } catch (_: InterruptedException) { return }
    }
  }

  private fun response(out: java.io.OutputStream, status: Int, reason: String, body: String) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    out.write(("HTTP/1.1 $status $reason\r\nContent-Type: text/plain; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\nContent-Length: " + bytes.size + "\r\nConnection: close\r\n\r\n")
      .toByteArray(Charsets.US_ASCII))
    out.write(bytes)
    out.flush()
  }

  private fun encodeJpeg(image: Image): ByteArray {
    val plane = image.planes[0]
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    require(pixelStride >= 4 && rowStride >= image.width * pixelStride)
    val fullWidth = rowStride / pixelStride
    val bitmap = Bitmap.createBitmap(fullWidth, image.height, Bitmap.Config.ARGB_8888)
    try {
      bitmap.copyPixelsFromBuffer(plane.buffer)
      val crop = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
      try {
        val result = ByteArrayOutputStream()
        crop.compress(Bitmap.CompressFormat.JPEG, 62, result)
        return result.toByteArray()
      } finally { crop.recycle() }
    } finally { bitmap.recycle() }
  }

  private fun notification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "Screen sharing", NotificationManager.IMPORTANCE_LOW))
    }
    val stop = Intent(this, ScreenShareService::class.java).setAction(ACTION_STOP)
    val intent = PendingIntent.getService(
      this, 3401, stop, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    return builder.setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle("Personal Voice is sharing your screen")
      .setContentText("Visible on your trusted local network. Tap Stop to end.")
      .setOngoing(true)
      .addAction(android.R.drawable.ic_delete, "Stop sharing", intent)
      .build()
  }

  override fun onDestroy() {
    running.set(false)
    try { listener?.close() } catch (_: Exception) {}
    try { client?.close() } catch (_: Exception) {}
    try { display?.release() } catch (_: Exception) {}
    try { reader?.close() } catch (_: Exception) {}
    try { projectionCallback?.let { projection?.unregisterCallback(it) } } catch (_: Exception) {}
    try { projection?.stop() } catch (_: Exception) {}
    encoderThread?.quitSafely()
    projection = null
    display = null
    listener = null
    ScreenSharing.closed(captureRequestId)
    super.onDestroy()
  }

  companion object {
    const val EXTRA_RESULT = "shareResultCode"
    const val EXTRA_DATA = "shareResultData"
    const val ACTION_STOP = "com.personal.voiceapp.STOP_SCREEN_SHARE"
    private const val CHANNEL = "pv_screen_share"
    private const val NOTIFICATION_ID = 4108
    private const val FRAME_INTERVAL_MS = 250L
  }
}
