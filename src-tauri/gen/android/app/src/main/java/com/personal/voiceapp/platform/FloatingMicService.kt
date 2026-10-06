package com.personal.voiceapp.platform

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import com.personal.voiceapp.MainActivity
import com.personal.voiceapp.R
import org.json.JSONObject

/**
 * Microphone foreground service that owns the floating control stack (Assistant, Remote
 * Dictation, Notes, then dictation) and its quick-actions panel.
 *
 * Android only lets a microphone foreground service start while the app is visible, so first
 * start (and boot restore) goes through MainActivity. Once running it keeps the bubble over
 * other apps. It never records by itself: shared WebView code captures only while the mic is
 * held, Remote Dictation is held, or Start dictation is used. Turn off via the notification
 * or setup clears the "want" preference so the session does not come back on its own.
 */
class FloatingMicService : Service() {
  interface Listener {
    fun onPushToTalk(event: String)
    fun onOverlayAction(payload: JSONObject)
    fun onRunningChanged(running: Boolean)
  }

  companion object {
    private const val TAG = "FloatingMicService"
    private const val CHANNEL_ID = "floating_mic"
    private const val NOTIFICATION_ID = 1
    private const val RESTORE_NOTIFICATION_ID = 2
    private const val ACTION_STOP = "com.personal.voiceapp.action.STOP_FLOATING_MIC"
    private const val BUBBLE_DP = 48
    private const val GAP_DP = 6
    private const val PANEL_WIDTH_DP = 280
    private const val TIP_HIDE_MS = 2200L

    /** Set by the plugin while the app's WebView is alive. */
    @Volatile var listener: Listener? = null

    @Volatile var instance: FloatingMicService? = null
      private set

    val isRunning: Boolean get() = instance != null
  }

  private val windowManager by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
  private var stack: LinearLayout? = null
  private var stackLayout: WindowManager.LayoutParams? = null
  private var assistantBubble: AssistantBubbleView? = null
  private var assistantInterrupt = false
  private var remoteBubble: RemoteDictationBubbleView? = null
  private var remoteTargetId: String? = null
  private var remoteHoldId = 0
  /** After a tap-cycle, show the selected device name beside the stack. */
  private var pendingRemoteTip = false
  private var remoteTip: TextView? = null
  private var remoteTipLayout: WindowManager.LayoutParams? = null
  private val tipHandler = Handler(Looper.getMainLooper())
  private val hideRemoteTipRunnable = Runnable { hideRemoteTip() }
  private var noteBubble: MicBubbleView? = null
  private var noteHoldId = 0
  private var micBubble: MicBubbleView? = null
  private var panel: OverlayPanelView? = null
  private var panelLayout: WindowManager.LayoutParams? = null
  private var snapshot = JSONObject()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      FloatingMicPrefs.setWantFloatingMic(this, false)
      stopSelf()
      return START_NOT_STICKY
    }
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not start the floating mic", error)
      if (FloatingMicPrefs.wantFloatingMic(this)) postRestoreNotification()
      stopSelf()
      return START_NOT_STICKY
    }
    NotificationManagerCompat.from(this).cancel(RESTORE_NOTIFICATION_ID)
    FloatingMicPrefs.setWantFloatingMic(this, true)
    if (stack == null) showStack()
    if (instance == null) {
      instance = this
      listener?.onRunningChanged(true)
    }
    return START_STICKY
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val view = stack ?: return
    val layout = stackLayout ?: return
    clampToScreen(layout)
    windowManager.updateViewLayout(view, layout)
    placePanel()
  }

  override fun onDestroy() {
    micBubble?.let {
      if (it.isHolding) emit("cancel")
    }
    remoteBubble?.let {
      if (it.isHolding) emitRemoteHold("stop")
    }
    noteBubble?.let {
      if (it.isHolding) emitNoteHold("cancel")
    }
    hideRemoteTip()
    stack?.let { windowManager.removeView(it) }
    hidePanel()
    stack = null
    stackLayout = null
    assistantBubble = null
    remoteBubble = null
    noteBubble = null
    micBubble = null
    instance = null
    listener?.onRunningChanged(false)
    super.onDestroy()
  }

  /** Main thread only. */
  fun showState(state: MicBubbleView.State) {
    micBubble?.state = state
    if (state == MicBubbleView.State.LISTENING || state == MicBubbleView.State.FINALIZING) hidePanel()
  }

  /** Main thread only. */
  fun showSnapshot(json: String) {
    snapshot = try {
      JSONObject(json)
    } catch (_: Exception) {
      JSONObject()
    }
    val dictation = snapshot.optString("dictation", "idle")
    val dictationState = when (dictation) {
      "listening" -> MicBubbleView.State.LISTENING
      "finalizing" -> MicBubbleView.State.FINALIZING
      "error" -> MicBubbleView.State.ERROR
      else -> MicBubbleView.State.IDLE
    }
    micBubble?.state = dictationState
    // Notes has its own one-shot destination; show it active only while held.
    noteBubble?.state = if (noteBubble?.isHolding == true) dictationState else MicBubbleView.State.IDLE
    assistantInterrupt = snapshot.optBoolean("assistantInterrupt")
    assistantBubble?.state = when (snapshot.optString("assistant", "idle")) {
      "listening" -> AssistantBubbleView.State.LISTENING
      "responding" -> AssistantBubbleView.State.RESPONDING
      "error" -> AssistantBubbleView.State.ERROR
      else -> AssistantBubbleView.State.IDLE
    }
    val cameraOn = snapshot.optBoolean("cameraOn")
    assistantBubble?.contentDescription = buildString {
      append(
        getString(
          if (assistantInterrupt) R.string.floating_assistant_interrupt else R.string.floating_assistant_tap,
        ),
      )
      if (cameraOn) append(". Camera On")
    }
    bindRemoteBubble(dictation)
    if (dictation == "listening" || dictation == "finalizing") {
      hidePanel()
    } else {
      panel?.bind(snapshot)
      placePanel()
    }
  }

  private fun bindRemoteBubble(dictation: String) {
    val online = snapshot.optBoolean("remoteTargetOnline", false)
    val targetId = snapshot.optString("remoteTargetId").takeIf {
      it.isNotEmpty() && snapshot.has("remoteTargetId") && !snapshot.isNull("remoteTargetId")
    }
    val targetLabel = snapshot.optString("remoteTargetLabel").takeIf { it.isNotEmpty() }
    val targetPlatform = snapshot.optString("remoteTargetPlatform").takeIf { it.isNotEmpty() }
    val targetKind = snapshot.optString("remoteTargetKind").takeIf { it.isNotEmpty() }
    val remoteActive = snapshot.optBoolean("remoteDictationActive", false)
    val notice = snapshot.optString("notice").takeIf {
      it.isNotEmpty() && snapshot.has("notice") && !snapshot.isNull("notice")
    }
    remoteTargetId = targetId
    remoteBubble?.state = when {
      !online || targetId == null -> RemoteDictationBubbleView.State.UNAVAILABLE
      remoteActive && dictation == "listening" -> RemoteDictationBubbleView.State.LISTENING
      remoteActive && dictation == "finalizing" -> RemoteDictationBubbleView.State.FINALIZING
      remoteActive && dictation == "error" -> RemoteDictationBubbleView.State.ERROR
      else -> RemoteDictationBubbleView.State.IDLE
    }
    remoteBubble?.deviceKind = RemoteDictationBubbleView.kindFrom(targetKind, targetPlatform, targetLabel)
    remoteBubble?.contentDescription = when {
      targetLabel != null && online -> getString(R.string.floating_remote_dictation_target, targetLabel)
      else -> getString(R.string.floating_remote_dictation_unavailable)
    }
    if (pendingRemoteTip) {
      pendingRemoteTip = false
      val tip = when {
        notice != null -> notice
        online && targetLabel != null -> getString(R.string.floating_remote_dictation_selected, targetLabel)
        else -> getString(R.string.floating_remote_dictation_unavailable)
      }
      showRemoteTip(tip)
    }
  }

  private fun showRemoteTip(message: String) {
    hideRemoteTip()
    val metrics = resources.displayMetrics
    val density = metrics.density
    val stackParams = stackLayout ?: return
    val size = (BUBBLE_DP * density).toInt()
    val gap = (GAP_DP * density).toInt()
    val tipGap = (8 * density).toInt()
    val view = TextView(this).apply {
      text = message
      setTextColor(0xFFE9EDF4.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      maxLines = 2
      background = GradientDrawable().apply {
        setColor(0xF219232E.toInt())
        cornerRadius = 10 * density
      }
      setPadding(
        (12 * density).toInt(),
        (8 * density).toInt(),
        (12 * density).toInt(),
        (8 * density).toInt(),
      )
      elevation = 10 * density
    }
    val widthSpec = View.MeasureSpec.makeMeasureSpec((200 * density).toInt(), View.MeasureSpec.AT_MOST)
    val heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    view.measure(widthSpec, heightSpec)
    val tipWidth = view.measuredWidth.coerceAtLeast((72 * density).toInt())
    val tipHeight = view.measuredHeight.coerceAtLeast((32 * density).toInt())
    // Align with the middle (Remote Dictation) bubble in the stack.
    val remoteTop = stackParams.y + size + gap
    val remoteCenterY = remoteTop + size / 2
    var x = stackParams.x - tipWidth - tipGap
    if (x < tipGap) x = stackParams.x + stackParams.width + tipGap
    val y = (remoteCenterY - tipHeight / 2).coerceIn(0, (metrics.heightPixels - tipHeight).coerceAtLeast(0))
    val layout = WindowManager.LayoutParams(
      tipWidth,
      tipHeight,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      this.x = x.coerceIn(0, (metrics.widthPixels - tipWidth).coerceAtLeast(0))
      this.y = y
    }
    windowManager.addView(view, layout)
    remoteTip = view
    remoteTipLayout = layout
    tipHandler.postDelayed(hideRemoteTipRunnable, TIP_HIDE_MS)
  }

  private fun hideRemoteTip() {
    tipHandler.removeCallbacks(hideRemoteTipRunnable)
    remoteTip?.let { runCatching { windowManager.removeView(it) } }
    remoteTip = null
    remoteTipLayout = null
  }

  private fun emitNoteHold(phase: String) {
    if (phase == "start") noteHoldId += 1
    emitOverlay(
      JSONObject()
        .put("type", "dictate-hold")
        .put("phase", phase)
        .put("destination", "voice-note")
        .put("id", noteHoldId),
    )
  }

  private fun emitRemoteHold(phase: String) {
    val targetId = remoteTargetId
    if (targetId.isNullOrEmpty()) {
      emitOverlay(JSONObject().put("type", "cycle-remote-target"))
      return
    }
    if (phase == "start") remoteHoldId += 1
    emitOverlay(
      JSONObject()
        .put("type", "remote-dictate-hold")
        .put("phase", phase)
        .put("targetId", targetId)
        .put("id", remoteHoldId),
    )
  }

  private fun emit(event: String) {
    val current = listener
    if (current == null) {
      wakeAppForWebView()
      return
    }
    current.onPushToTalk(event)
  }

  private fun emitOverlay(payload: JSONObject) {
    val current = listener
    if (current == null) {
      wakeAppForWebView()
      return
    }
    current.onOverlayAction(payload)
  }

  /** Activity/WebView died while the FGS kept running — bring Settings back so the plugin reattaches. */
  private fun wakeAppForWebView() {
    startActivity(FloatingMicIntents.wakeIntent(this))
    Toast.makeText(this, R.string.floating_mic_opening_app, Toast.LENGTH_SHORT).show()
  }

  private fun showStack() {
    val metrics = resources.displayMetrics
    val size = (BUBBLE_DP * metrics.density).toInt()
    val gap = (GAP_DP * metrics.density).toInt()
    val prefs = getSharedPreferences(FloatingMicPrefs.PREFS, MODE_PRIVATE)
    val overlayType = overlayType()
    val stackHeight = size * 4 + gap * 3
    val layout = WindowManager.LayoutParams(
      size, stackHeight, overlayType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = prefs.getInt("x", metrics.widthPixels - size - size / 4)
      y = prefs.getInt("y", metrics.heightPixels / 2)
    }
    clampToScreen(layout)

    val host = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      clipChildren = false
      clipToPadding = false
    }

    var dragOriginX = 0
    var dragOriginY = 0
    val dragCallbacks = object {
      fun onDragStart() {
        dragOriginX = layout.x
        dragOriginY = layout.y
      }
      fun onDragBy(dx: Int, dy: Int) {
        layout.x = dragOriginX + dx
        layout.y = dragOriginY + dy
        clampToScreen(layout)
        host.let { windowManager.updateViewLayout(it, layout) }
        placePanel()
      }
      fun onDragEnd() {
        prefs.edit().putInt("x", layout.x).putInt("y", layout.y).apply()
      }
    }

    val assistant = AssistantBubbleView(this, object : AssistantBubbleView.Callbacks {
      override fun onTap() {
        val type = if (assistantInterrupt) "assistant-interrupt" else "assistant-toggle"
        emitOverlay(JSONObject().put("type", type))
      }
      override fun onDragStart() = dragCallbacks.onDragStart()
      override fun onDragBy(dx: Int, dy: Int) = dragCallbacks.onDragBy(dx, dy)
      override fun onDragEnd() = dragCallbacks.onDragEnd()
    })

    fun gapView() = View(this).apply {
      layoutParams = LinearLayout.LayoutParams(size, gap)
    }

    val remote = RemoteDictationBubbleView(this, object : RemoteDictationBubbleView.Callbacks {
      override fun onTap() {
        // Cycle never starts the mic; the next snapshot shows a side tip with the device name.
        pendingRemoteTip = true
        emitOverlay(JSONObject().put("type", "cycle-remote-target"))
      }
      override fun onPress() {
        hidePanel()
        emitRemoteHold("start")
      }
      override fun onRelease() = emitRemoteHold("stop")
      override fun onCancel() = emitRemoteHold("stop")
      override fun onDragStart() = dragCallbacks.onDragStart()
      override fun onDragBy(dx: Int, dy: Int) = dragCallbacks.onDragBy(dx, dy)
      override fun onDragEnd() = dragCallbacks.onDragEnd()
    })

    val note = MicBubbleView(this, object : MicBubbleView.Callbacks {
      override fun onTap() {
        Toast.makeText(this@FloatingMicService, R.string.floating_note_tip, Toast.LENGTH_SHORT).show()
      }
      override fun onPress() {
        hidePanel()
        emitNoteHold("start")
      }
      override fun onRelease() = emitNoteHold("stop")
      override fun onCancel() = emitNoteHold("cancel")
      override fun onDragStart() = dragCallbacks.onDragStart()
      override fun onDragBy(dx: Int, dy: Int) = dragCallbacks.onDragBy(dx, dy)
      override fun onDragEnd() = dragCallbacks.onDragEnd()
    }, iconRes = R.drawable.ic_note, descriptionRes = R.string.floating_note_hold)

    val mic = MicBubbleView(this, object : MicBubbleView.Callbacks {
      override fun onTap() {
        if (micBubble?.state == MicBubbleView.State.LISTENING) {
          emitOverlay(JSONObject().put("type", "dictate-toggle"))
        } else {
          togglePanel()
        }
      }
      override fun onPress() = emit("press")
      override fun onRelease() = emit("release")
      override fun onCancel() = emit("cancel")
      override fun onDragStart() = dragCallbacks.onDragStart()
      override fun onDragBy(dx: Int, dy: Int) = dragCallbacks.onDragBy(dx, dy)
      override fun onDragEnd() = dragCallbacks.onDragEnd()
    })

    host.addView(assistant, LinearLayout.LayoutParams(size, size))
    host.addView(gapView())
    host.addView(remote, LinearLayout.LayoutParams(size, size))
    host.addView(gapView())
    host.addView(note, LinearLayout.LayoutParams(size, size))
    host.addView(gapView())
    host.addView(mic, LinearLayout.LayoutParams(size, size))

    windowManager.addView(host, layout)
    stack = host
    stackLayout = layout
    assistantBubble = assistant
    remoteBubble = remote
    noteBubble = note
    micBubble = mic
    bindRemoteBubble(snapshot.optString("dictation", "idle"))
  }

  private fun togglePanel() {
    if (panel != null) hidePanel() else showPanel()
  }

  private fun showPanel() {
    if (panel != null) return
    val metrics = resources.displayMetrics
    val width = (PANEL_WIDTH_DP * metrics.density).toInt()
    val layout = WindowManager.LayoutParams(
      width, WindowManager.LayoutParams.WRAP_CONTENT, overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
    }
    val view = OverlayPanelView(this) { payload -> emitOverlay(payload) }
    view.bind(snapshot)
    windowManager.addView(view, layout)
    panel = view
    panelLayout = layout
    view.post { placePanel() }
  }

  private fun hidePanel() {
    panel?.let { windowManager.removeView(it) }
    panel = null
    panelLayout = null
  }

  private fun placePanel() {
    val view = panel ?: return
    val panelParams = panelLayout ?: return
    val stackParams = stackLayout ?: return
    val metrics = resources.displayMetrics
    val gap = (8 * metrics.density).toInt()
    val width = panelParams.width
    val height = view.height.coerceAtLeast((80 * metrics.density).toInt())
    var x = stackParams.x - width - gap
    if (x < 0) x = stackParams.x + stackParams.width + gap
    // Anchor beside the mic (bottom bubble) so the sheet feels tied to dictation actions.
    var y = stackParams.y + stackParams.height - height
    panelParams.x = x.coerceIn(0, (metrics.widthPixels - width).coerceAtLeast(0))
    panelParams.y = y.coerceIn(0, (metrics.heightPixels - height).coerceAtLeast(0))
    windowManager.updateViewLayout(view, panelParams)
  }

  private fun overlayType(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
  } else {
    @Suppress("DEPRECATION")
    WindowManager.LayoutParams.TYPE_PHONE
  }

  /** Reads the current display size, so it stays right after rotation. */
  private fun clampToScreen(layout: WindowManager.LayoutParams) {
    val metrics = resources.displayMetrics
    layout.x = layout.x.coerceIn(0, (metrics.widthPixels - layout.width).coerceAtLeast(0))
    layout.y = layout.y.coerceIn(0, (metrics.heightPixels - layout.height).coerceAtLeast(0))
  }

  private fun ensureChannel() {
    NotificationManagerCompat.from(this).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName(getString(R.string.floating_mic_channel))
        .setDescription(getString(R.string.floating_mic_channel_description))
        .build(),
    )
  }

  private fun buildNotification(): Notification {
    ensureChannel()
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

  /**
   * Sticky restart from the background cannot start a microphone FGS on Android 14+.
   * Ask the user to open the app so a visible activity can restore the session.
   */
  private fun postRestoreNotification() {
    ensureChannel()
    val open = PendingIntent.getActivity(
      this,
      2,
      FloatingMicIntents.autostartIntent(this),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_mic)
      .setContentTitle(getString(R.string.floating_mic_restore_title))
      .setContentText(getString(R.string.floating_mic_restore_text))
      .setContentIntent(open)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()
    NotificationManagerCompat.from(this).notify(RESTORE_NOTIFICATION_ID, notification)
  }
}
