package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Compact quick-actions sheet next to the floating mic. Clicks emit overlay actions
 * back to the shared TypeScript; copy also writes the Android clipboard so it works
 * while the WebView is backgrounded.
 */
@SuppressLint("ViewConstructor")
class OverlayPanelView(context: Context, private val onAction: (JSONObject) -> Unit) : ScrollView(context) {
  private val stack = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(12), dp(10), dp(12), dp(12))
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  private var remoteHoldId = 0

  init {
    addView(stack, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    background = roundRect(0xF219232E.toInt(), dp(12).toFloat())
    isVerticalScrollBarEnabled = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val max = (420 * resources.displayMetrics.density).toInt()
    super.onMeasure(widthMeasureSpec, View.MeasureSpec.makeMeasureSpec(max, View.MeasureSpec.AT_MOST))
  }

  fun bind(snapshot: JSONObject) {
    stack.removeAllViews()
    addLabel("Quick actions")
    addButton("Start dictation", primary = true) { emit("dictate-toggle") }
    val assistant = snapshot.optString("assistant", "idle")
    val assistantLabel = when (assistant) {
      "listening", "responding" -> "End Assistant"
      "error" -> "Retry Assistant"
      else -> "Start Assistant"
    }
    addButton(assistantLabel) { emit("assistant-toggle") }
    if (snapshot.optBoolean("assistantInterrupt")) {
      addButton("Stop and listen", primary = true) { emit("assistant-interrupt") }
      addPreview("The microphone is paused while the reply plays. Stop and listen interrupts it. Talking over the reply will not.")
    }
    when (assistant) {
      "listening" -> if (!snapshot.optBoolean("assistantInterrupt")) addPreview("Assistant is listening")
      "responding" -> if (!snapshot.optBoolean("assistantInterrupt")) addPreview("Assistant is speaking")
      "error" -> snapshot.optString("assistantError").takeIf { it.isNotEmpty() }?.let { addPreview(it, error = true) }
      else -> Unit
    }
    if (snapshot.optBoolean("cameraOn")) {
      addPreview("Camera On")
    }
    val pending = snapshot.optString("pendingTitle")
    if (pending.isNotEmpty() && snapshot.has("pendingTitle") && !snapshot.isNull("pendingTitle")) {
      addLabel("Assistant wants to:")
      addPreview(pending)
      val preview = snapshot.optString("pendingPreview")
      if (preview.isNotEmpty() && snapshot.has("pendingPreview") && !snapshot.isNull("pendingPreview")) {
        addPreview(preview)
      }
      if (snapshot.optBoolean("pendingWorking", false)) {
        addPreview("Working…")
      } else {
        addButton("Confirm", primary = true) { emit("confirm-action") }
        addButton("Cancel") { emit("cancel-action") }
      }
    }
    val selection = snapshot.optString("selectionPreview")
    if (selection.isNotEmpty() && snapshot.has("selectionPreview") && !snapshot.isNull("selectionPreview")) {
      val source = snapshot.optString("selectionSource")
      addPreview(if (source.isNotEmpty()) "From $source: $selection" else selection)
      addButton("Remove selection") { emit("detach-selection") }
    }

    addLabel("Send transcript to")
    val destinations = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    val selected = snapshot.optString("destination", "active-field")
    listOf(
      "active-field" to "Active field",
      "voice-note" to "Voice note",
      "remote-dictation" to "Remote",
    ).forEach { (id, label) ->
      destinations.addView(
        chip(label, selected == id) {
          emit("set-destination") { it.put("destination", id) }
        },
        LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) },
      )
    }
    stack.addView(destinations, itemParams())

    addRemoteDictationControl(snapshot)

    addButton("Capture selection") { emit("capture-selection") }
    snapshot.optString("capture").takeIf { it.isNotEmpty() && snapshot.has("capture") && !snapshot.isNull("capture") }
      ?.let { addPreview(it) }
    snapshot.optString("notice").takeIf { it.isNotEmpty() && snapshot.has("notice") && !snapshot.isNull("notice") }
      ?.let { addPreview(it) }
    if (snapshot.optString("dictation") == "error") {
      snapshot.optString("error").takeIf { it.isNotEmpty() }?.let { addPreview(it, error = true) }
    }

    addSection("Voice notes", "No inbox notes.", snapshot.optJSONArray("notes") ?: JSONArray()) { item ->
      addItemActions({ copy(item); emit("copy-note") { it.put("id", item.optString("id")) } })
    }
    addSection("Handoffs", "No pending handoffs.", snapshot.optJSONArray("handoffs") ?: JSONArray()) { item ->
      addItemActions(
        onCopy = { copy(item); emit("copy-handoff") { it.put("id", item.optString("id")) } },
        onInsert = { emit("insert-handoff") { it.put("id", item.optString("id")) } },
        onDismiss = { emit("dismiss-handoff") { it.put("id", item.optString("id")) } },
      )
    }
    addButton("Open Settings") { emit("open-settings") }
  }

  private fun addSection(title: String, empty: String, items: JSONArray, actions: LinearLayout.(JSONObject) -> Unit) {
    addLabel(title)
    if (items.length() == 0) {
      addPreview(empty)
      return
    }
    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val block = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = roundRect(0xFF111820.toInt(), dp(8).toFloat())
        setPadding(dp(10), dp(8), dp(10), dp(8))
      }
      block.addView(text(clip(item.optString("text")), 13f, 0xFFE9EDF4.toInt()))
      block.addView(text(item.optString("meta"), 11f, 0xFFA2ADBC.toInt()).apply {
        setPadding(0, dp(2), 0, dp(6))
      })
      val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
      row.actions(item)
      block.addView(row)
      stack.addView(block, itemParams())
    }
  }

  private fun LinearLayout.addItemActions(
    onCopy: () -> Unit,
    onInsert: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
  ) {
    addView(smallButton("Copy", onCopy), chipParams())
    if (onInsert != null) addView(smallButton("Insert", onInsert), chipParams())
    if (onDismiss != null) addView(smallButton("Dismiss", onDismiss), chipParams())
  }

  private fun addRemoteDictationControl(snapshot: JSONObject) {
    addLabel("Remote Dictation")
    val targetId = snapshot.optString("remoteTargetId").takeIf { it.isNotEmpty() && snapshot.has("remoteTargetId") && !snapshot.isNull("remoteTargetId") }
    val targetLabel = snapshot.optString("remoteTargetLabel").takeIf { it.isNotEmpty() } ?: "No device online"
    val online = snapshot.optBoolean("remoteTargetOnline", false)
    val active = snapshot.optBoolean("remoteDictationActive", false)
    val count = snapshot.optInt("remoteTargetCount", 0)
    val status = when {
      active -> "Listening → $targetLabel"
      !online || targetId == null -> "Unavailable"
      count == 1 -> "Hold for $targetLabel"
      else -> "Tap to cycle · Hold for $targetLabel"
    }
    addPreview(status, error = !online || targetId == null)
    val button = text(
      if (online && targetId != null) "→ $targetLabel" else "Remote Dictation",
      13f,
      if (online && targetId != null) 0xFF111820.toInt() else 0xFFE9EDF4.toInt(),
    ).apply {
      gravity = Gravity.CENTER
      background = roundRect(
        if (online && targetId != null) 0xFF88D8C1.toInt() else 0x00000000,
        dp(999).toFloat(),
        stroke = !(online && targetId != null),
      )
      setPadding(dp(10), dp(8), dp(10), dp(8))
      // Always tappable: short tap cycles (or flashes "no device"); hold only when online.
      bindRemoteHold(this, targetId, online && targetId != null)
    }
    stack.addView(button, itemParams())
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun bindRemoteHold(view: TextView, targetId: String?, holdEnabled: Boolean) {
    var holdStarted = false
    var pointerDown = false
    var holdRunnable: Runnable? = null
    var gestureId = 0
    view.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          pointerDown = true
          holdStarted = false
          remoteHoldId += 1
          gestureId = remoteHoldId
          val id = gestureId
          val lockedTarget = targetId
          if (holdEnabled && lockedTarget != null) {
            holdRunnable = Runnable {
              if (!pointerDown || holdStarted) return@Runnable
              holdStarted = true
              emit("remote-dictate-hold") {
                it.put("phase", "start")
                it.put("targetId", lockedTarget)
                it.put("id", id)
              }
            }
            // Match MicBubbleView / RemoteDictationBubbleView (touch-friendly).
            mainHandler.postDelayed(holdRunnable!!, 400L)
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          pointerDown = false
          holdRunnable?.let { mainHandler.removeCallbacks(it) }
          holdRunnable = null
          if (holdStarted && targetId != null) {
            emit("remote-dictate-hold") {
              it.put("phase", "stop")
              it.put("targetId", targetId)
              it.put("id", gestureId)
            }
          } else if (event.actionMasked == MotionEvent.ACTION_UP) {
            emit("cycle-remote-target")
          }
          true
        }
        else -> false
      }
    }
  }

  private fun addButton(label: String, primary: Boolean = false, onClick: () -> Unit) {
    stack.addView(
      text(label, 13f, if (primary) 0xFF111820.toInt() else 0xFFE9EDF4.toInt()).apply {
        gravity = Gravity.CENTER
        background = roundRect(if (primary) 0xFF88D8C1.toInt() else 0x00000000, dp(999).toFloat(), stroke = !primary)
        setPadding(dp(10), dp(8), dp(10), dp(8))
        setOnClickListener { onClick() }
      },
      itemParams(),
    )
  }

  private fun smallButton(label: String, onClick: () -> Unit) =
    text(label, 12f, 0xFFE9EDF4.toInt()).apply {
      gravity = Gravity.CENTER
      background = roundRect(0x00000000, dp(999).toFloat(), stroke = true)
      setPadding(dp(8), dp(4), dp(8), dp(4))
      setOnClickListener { onClick() }
    }

  private fun chip(label: String, on: Boolean, onClick: () -> Unit) =
    text(label, 11f, if (on) 0xFF111820.toInt() else 0xFFE9EDF4.toInt()).apply {
      gravity = Gravity.CENTER
      background = roundRect(if (on) 0xFF88D8C1.toInt() else 0x00000000, dp(999).toFloat(), stroke = !on)
      setPadding(dp(4), dp(6), dp(4), dp(6))
      setOnClickListener { onClick() }
    }

  private fun addLabel(label: String) {
    stack.addView(text(label, 11f, 0xFFB2BECC.toInt()).apply {
      typeface = Typeface.DEFAULT_BOLD
      setPadding(0, dp(8), 0, dp(6))
    })
  }

  private fun addPreview(body: String, error: Boolean = false) {
    stack.addView(text(body, 12f, if (error) 0xFFF3A7A7.toInt() else 0xFFB2BECC.toInt()), itemParams())
  }

  private fun emit(type: String, extra: (JSONObject) -> Unit = {}) {
    onAction(JSONObject().put("type", type).also(extra))
  }

  private fun copy(item: JSONObject) {
    val text = item.optString("text")
    if (text.isEmpty()) return
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Personal Voice", text))
  }

  private fun text(value: String, size: Float, color: Int) = TextView(context).apply {
    this.text = value
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
  }

  private fun clip(value: String): String {
    val trimmed = value.replace(Regex("\\s+"), " ").trim()
    return if (trimmed.length <= 160) trimmed else trimmed.take(159) + "…"
  }

  private fun itemParams() = LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
    bottomMargin = dp(6)
  }

  private fun chipParams() = LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
    marginEnd = dp(6)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private fun roundRect(color: Int, radius: Float, stroke: Boolean = false) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = radius
    if (stroke) setStroke(dp(1), 0xFF344252.toInt())
  }
}
