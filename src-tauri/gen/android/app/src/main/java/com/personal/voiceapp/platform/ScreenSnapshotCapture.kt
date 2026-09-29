package com.personal.voiceapp.platform

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One MediaProjection frame. The consent dialog is the user's explicit action.
 * The projection and virtual display are released as soon as that frame is copied.
 * Nothing is written to disk and nothing captures again on a timer.
 */
object ScreenSnapshotCapture {
  private val main = Handler(Looper.getMainLooper())
  private var callback: ((String?, String?) -> Unit)? = null

  fun begin(activity: Activity, done: (jpeg: String?, error: String?) -> Unit) {
    if (callback != null) {
      done(null, "A screenshot is already in progress.")
      return
    }
    callback = done
    val service = Intent(activity, ScreenCaptureService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      activity.startForegroundService(service)
    } else {
      activity.startService(service)
    }
    activity.startActivity(Intent(activity, ScreenCaptureActivity::class.java))
  }

  fun finishConsent(context: Context, resultCode: Int, data: Intent?) {
    if (resultCode != Activity.RESULT_OK || data == null) {
      stop(context)
      deliver(null, "Screen capture was cancelled.")
      return
    }
    val intent = Intent(context, ScreenCaptureService::class.java)
      .putExtra(ScreenCaptureService.EXTRA_CODE, resultCode)
      .putExtra(ScreenCaptureService.EXTRA_DATA, data)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  fun deliver(jpeg: String?, error: String?) {
    val pending = callback
    callback = null
    if (pending == null) return
    main.post { pending(jpeg, error) }
  }

  fun stop(context: Context) {
    context.stopService(Intent(context, ScreenCaptureService::class.java))
  }
}

/** System screen-capture consent. Finishes itself as soon as the user answers. */
class ScreenCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    val manager = getSystemService(MediaProjectionManager::class.java)
    @Suppress("DEPRECATION")
    startActivityForResult(manager.createScreenCaptureIntent(), 41)
  }

  @Deprecated("The consent dialog still returns through onActivityResult.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    ScreenSnapshotCapture.finishConsent(this, resultCode, data)
    finish()
  }
}

/** Holds the projection only long enough to copy one frame. */
class ScreenCaptureService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      } else {
        startForeground(NOTIFICATION_ID, notification())
      }
    } catch (_: RuntimeException) {
      ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
      stopSelf()
      return START_NOT_STICKY
    }
    val code = intent?.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
    val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent?.getParcelableExtra(EXTRA_DATA)
    }
    if (code != Activity.RESULT_OK || data == null) return START_NOT_STICKY
    capture(code, data)
    return START_NOT_STICKY
  }

  private fun capture(code: Int, data: Intent) {
    val manager = getSystemService(MediaProjectionManager::class.java)
    val projection = try {
      manager.getMediaProjection(code, data)
    } catch (_: RuntimeException) {
      null
    }
    if (projection == null) {
      ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
      stopSelf()
      return
    }
    val metrics = resources.displayMetrics
    val (width, height) = fit(metrics.widthPixels, metrics.heightPixels)
    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    val delivered = AtomicBoolean(false)
    var display: VirtualDisplay? = null
    projection.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() {
        if (delivered.compareAndSet(false, true)) {
          ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
        }
      }
    }, Handler(mainLooper))
    val timeout = Runnable {
      if (delivered.compareAndSet(false, true)) {
        release(projection, display, reader)
        ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
        stopSelf()
      }
    }
    reader.setOnImageAvailableListener({
      if (!delivered.compareAndSet(false, true)) return@setOnImageAvailableListener
      Handler(mainLooper).removeCallbacks(timeout)
      val image = reader.acquireLatestImage()
      val jpeg = if (image == null) null else try {
        jpegOf(image)
      } catch (_: RuntimeException) {
        null
      } finally {
        image?.close()
      }
      release(projection, display, reader)
      if (jpeg == null) ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
      else ScreenSnapshotCapture.deliver(jpeg, null)
      stopSelf()
    }, Handler(mainLooper))
    display = projection.createVirtualDisplay(
      "personal-voice-snapshot",
      width,
      height,
      metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      Handler(mainLooper),
    )
    Handler(mainLooper).postDelayed(timeout, 3_000)
    if (display == null && delivered.compareAndSet(false, true)) {
      Handler(mainLooper).removeCallbacks(timeout)
      reader.close()
      projection.stop()
      ScreenSnapshotCapture.deliver(null, "Couldn't capture the screen.")
      stopSelf()
    }
  }

  private fun jpegOf(image: android.media.Image): String {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val rowPadding = rowStride - pixelStride * image.width
    val wide = Bitmap.createBitmap(
      image.width + rowPadding / pixelStride,
      image.height,
      Bitmap.Config.ARGB_8888,
    )
    wide.copyPixelsFromBuffer(buffer)
    val cropped = Bitmap.createBitmap(wide, 0, 0, image.width, image.height)
    if (cropped !== wide) wide.recycle()
    val stream = ByteArrayOutputStream()
    var quality = 72
    cropped.compress(Bitmap.CompressFormat.JPEG, quality, stream)
    while (stream.size() > 1_000_000 && quality > 40) {
      quality -= 12
      stream.reset()
      cropped.compress(Bitmap.CompressFormat.JPEG, quality, stream)
    }
    cropped.recycle()
    if (stream.size() > 1_000_000) throw IllegalStateException("too large")
    return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
  }

  private fun release(projection: MediaProjection, display: VirtualDisplay?, reader: ImageReader) {
    display?.release()
    reader.close()
    projection.stop()
  }

  private fun notification(): android.app.Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Screen snapshot", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.Notification.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setContentTitle("Capturing the screen")
        .setContentText("Personal Voice is taking one screenshot.")
        .build()
    } else {
      @Suppress("DEPRECATION")
      android.app.Notification.Builder(this)
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setContentTitle("Capturing the screen")
        .setContentText("Personal Voice is taking one screenshot.")
        .build()
    }
  }

  private fun fit(width: Int, height: Int): Pair<Int, Int> {
    val long = maxOf(width, height)
    if (long <= 1280) return width.coerceAtLeast(1) to height.coerceAtLeast(1)
    val scale = 1280.0 / long
    return (width * scale).toInt().coerceAtLeast(1) to (height * scale).toInt().coerceAtLeast(1)
  }

  companion object {
    const val EXTRA_CODE = "resultCode"
    const val EXTRA_DATA = "resultData"
    private const val CHANNEL_ID = "screen_snapshot"
    private const val NOTIFICATION_ID = 2
  }
}
