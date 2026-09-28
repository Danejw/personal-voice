package com.personal.voiceapp.platform

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import com.personal.voiceapp.MainActivity
import com.personal.voiceapp.R

/**
 * Microphone foreground service that owns the floating mic bubble.
 *
 * Android only lets a microphone foreground service start while the app is visible, so it is
 * turned on from the app's setup screen. It then keeps microphone access while the user is in
 * other apps. It never records by itself: the shared WebView code captures audio only while
 * the bubble is held, and the ongoing notification can turn the service off at any time.
 */
class FloatingMicService : Service() {
  interface Listener {
    fun onPushToTalk(event: String)
    fun onRunningChanged(running: Boolean)
  }

  companion object {
    private const val TAG = "FloatingMicService"
    private const val CHANNEL_ID = "floating_mic"
    private const val NOTIFICATION_ID = 1
    private const val ACTION_STOP = "com.personal.voiceapp.action.STOP_FLOATING_MIC"
    private const val PREFS = "floating_mic"
    private const val BUBBLE_DP = 60

    /** Set by the plugin while the app's WebView is alive. */
    @Volatile var listener: Listener? = null

    @Volatile var instance: FloatingMicService? = null
      private set

    val isRunning: Boolean get() = instance != null
  }

  private val windowManager by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
  private var bubble: MicBubbleView? = null
  private var bubbleLayout: WindowManager.LayoutParams? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
    } catch (error: RuntimeException) {
      // Microphone permission missing, or started while the app wasn't visible.
      Log.w(TAG, "Could not start the floating mic", error)
      stopSelf()
      return START_NOT_STICKY
    }
    if (bubble == null) showBubble()
    if (instance == null) {
      instance = this
      listener?.onRunningChanged(true)
    }
    // Not sticky: after a kill the WebView that does the dictation is gone too, and a
    // microphone service can't legally restart from the background anyway.
    return START_NOT_STICKY
  }

  /** A position saved in one orientation can be off screen in the other. */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val view = bubble ?: return
    val layout = bubbleLayout ?: return
    clampToScreen(layout)
    windowManager.updateViewLayout(view, layout)
  }

  override fun onDestroy() {
    bubble?.let {
      if (it.isHolding) emit("cancel")
      windowManager.removeView(it)
    }
    bubble = null
    bubbleLayout = null
    instance = null
    listener?.onRunningChanged(false)
    super.onDestroy()
  }

  /** Main thread only. */
  fun showState(state: MicBubbleView.State) {
    bubble?.state = state
  }

  private fun emit(event: String) {
    val current = listener
    if (current == null) {
      Toast.makeText(this, R.string.floating_mic_app_closed, Toast.LENGTH_SHORT).show()
      return
    }
    current.onPushToTalk(event)
  }

  private fun showBubble() {
    val metrics = resources.displayMetrics
    val size = (BUBBLE_DP * metrics.density).toInt()
    val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
    val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
    val layout = WindowManager.LayoutParams(
      size, size, overlayType,
      // Never focusable: touching the bubble must leave keyboard focus in the app being dictated into.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = prefs.getInt("x", metrics.widthPixels - size - size / 4)
      y = prefs.getInt("y", metrics.heightPixels / 2)
    }
    clampToScreen(layout)
    var dragOriginX = 0
    var dragOriginY = 0
    val view = MicBubbleView(this, object : MicBubbleView.Callbacks {
      override fun onPress() = emit("press")
      override fun onRelease() = emit("release")
      override fun onCancel() = emit("cancel")
      override fun onDragStart() {
        dragOriginX = layout.x
        dragOriginY = layout.y
      }
      override fun onDragBy(dx: Int, dy: Int) {
        layout.x = dragOriginX + dx
        layout.y = dragOriginY + dy
        clampToScreen(layout)
        bubble?.let { windowManager.updateViewLayout(it, layout) }
      }
      override fun onDragEnd() {
        prefs.edit().putInt("x", layout.x).putInt("y", layout.y).apply()
      }
    })
    windowManager.addView(view, layout)
    bubble = view
    bubbleLayout = layout
  }

  /** Reads the current display size, so it stays right after rotation. */
  private fun clampToScreen(layout: WindowManager.LayoutParams) {
    val metrics = resources.displayMetrics
    layout.x = layout.x.coerceIn(0, (metrics.widthPixels - layout.width).coerceAtLeast(0))
    layout.y = layout.y.coerceIn(0, (metrics.heightPixels - layout.height).coerceAtLeast(0))
  }

  private fun buildNotification(): Notification {
    NotificationManagerCompat.from(this).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(getString(R.string.floating_mic_channel))
        .setDescription(getString(R.string.floating_mic_channel_description))
        .build(),
    )
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, FloatingMicService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_mic)
      .setContentTitle(getString(R.string.floating_mic_title))
      .setContentText(getString(R.string.floating_mic_text))
      .setOngoing(true)
      .setContentIntent(open)
      .addAction(0, getString(R.string.floating_mic_turn_off), stop)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }
}
