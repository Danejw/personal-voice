package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.core.content.ContextCompat
import com.personal.voiceapp.R
import kotlin.math.hypot
import kotlin.math.min

/**
 * Floating Remote Dictation control.
 * Short tap cycles the target device. Holding past [HOLD_MS] starts Remote Dictation;
 * release finalizes. Dragging cancels a started hold so nothing is sent.
 *
 * The icon reflects the selected device kind (phone / laptop / desktop). The device
 * name is shown in a side tip owned by [FloatingMicService], not on the bubble.
 *
 * [HOLD_MS] is 400 ms (same as [MicBubbleView]) so a normal finger tap still counts as a
 * cycle; Windows keeps the shared 300 ms mouse threshold.
 */
@SuppressLint("ViewConstructor")
class RemoteDictationBubbleView(context: Context, private val callbacks: Callbacks) : View(context) {
  interface Callbacks {
    fun onTap()
    fun onPress()
    fun onRelease()
    fun onCancel()
    fun onDragStart()
    fun onDragBy(dx: Int, dy: Int)
    fun onDragEnd()
  }

  enum class State(val color: Int) {
    IDLE(0xFF88D8C1.toInt()),
    LISTENING(0xFFE76F51.toInt()),
    FINALIZING(0xFFE9C46A.toInt()),
    ERROR(0xFFF3A7A7.toInt()),
    UNAVAILABLE(0xFF5A6672.toInt()),
  }

  enum class DeviceKind {
    PHONE,
    LAPTOP,
    DESKTOP,
    UNKNOWN,
  }

  var state = State.IDLE
    set(value) {
      field = value
      invalidate()
    }

  var deviceKind = DeviceKind.UNKNOWN
    set(value) {
      if (field == value) return
      field = value
      icon = iconFor(value)
      invalidate()
    }

  var isHolding = false
    private set

  private val holdHandler = Handler(Looper.getMainLooper())
  private val dragThreshold = ViewConfiguration.get(context).scaledTouchSlop * 3f
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private var icon = iconFor(DeviceKind.UNKNOWN)
  private var downX = 0f
  private var downY = 0f
  private var dragging = false
  private var holdStarted = false
  private val beginHold = Runnable {
    if (state == State.UNAVAILABLE) return@Runnable
    holdStarted = true
    isHolding = true
    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    callbacks.onPress()
    invalidate()
  }

  init {
    contentDescription = context.getString(R.string.floating_remote_dictation)
  }

  override fun onDraw(canvas: Canvas) {
    fill.color = state.color
    val radius = min(width, height) / 2f
    canvas.drawCircle(width / 2f, height / 2f, if (isHolding) radius else radius * 0.88f, fill)
    val inset = (min(width, height) * 0.28f).toInt()
    icon.setBounds(inset, inset, width - inset, height - inset)
    icon.draw(canvas)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.rawX
        downY = event.rawY
        dragging = false
        holdStarted = false
        isHolding = false
        // Unavailable still accepts a tap so the app can flash "no device".
        if (state != State.UNAVAILABLE) {
          holdHandler.postDelayed(beginHold, HOLD_MS)
        }
        invalidate()
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downX
        val dy = event.rawY - downY
        if (!dragging && hypot(dx, dy) > dragThreshold) {
          holdHandler.removeCallbacks(beginHold)
          dragging = true
          if (holdStarted) {
            isHolding = false
            callbacks.onCancel()
          }
          callbacks.onDragStart()
          invalidate()
        }
        if (dragging) callbacks.onDragBy(dx.toInt(), dy.toInt())
      }
      MotionEvent.ACTION_UP -> {
        holdHandler.removeCallbacks(beginHold)
        when {
          dragging -> callbacks.onDragEnd()
          holdStarted -> callbacks.onRelease()
          else -> {
            performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            callbacks.onTap()
          }
        }
        reset()
      }
      MotionEvent.ACTION_CANCEL -> {
        holdHandler.removeCallbacks(beginHold)
        if (holdStarted) callbacks.onCancel()
        if (dragging) callbacks.onDragEnd()
        reset()
      }
    }
    return true
  }

  private fun reset() {
    isHolding = false
    dragging = false
    holdStarted = false
    invalidate()
  }

  private fun iconFor(kind: DeviceKind): Drawable {
    val res = when (kind) {
      DeviceKind.PHONE -> R.drawable.ic_device_phone
      DeviceKind.LAPTOP -> R.drawable.ic_device_laptop
      DeviceKind.DESKTOP -> R.drawable.ic_device_desktop
      DeviceKind.UNKNOWN -> R.drawable.ic_remote_dictation
    }
    return ContextCompat.getDrawable(context, res)!!.mutate().apply {
      setTint(0xFF111820.toInt())
    }
  }

  companion object {
    /** Touch-friendly; matches [MicBubbleView.HOLD_MS]. Windows uses 300 ms. */
    const val HOLD_MS = 400L

    fun kindFrom(snapshotKind: String?, platform: String?, label: String?): DeviceKind {
      when (snapshotKind?.lowercase()) {
        "phone" -> return DeviceKind.PHONE
        "laptop" -> return DeviceKind.LAPTOP
        "desktop" -> return DeviceKind.DESKTOP
      }
      val normalized = platform?.trim()?.lowercase().orEmpty()
      if (normalized == "android" || normalized == "ios") return DeviceKind.PHONE
      if (
        normalized == "windows"
        || normalized == "macos"
        || normalized == "linux"
        || normalized == "desktop"
      ) {
        val name = label?.lowercase().orEmpty()
        if (Regex("""\b(laptop|notebook|macbook|surface\s*laptop)\b""").containsMatchIn(name)) {
          return DeviceKind.LAPTOP
        }
        return DeviceKind.DESKTOP
      }
      return DeviceKind.UNKNOWN
    }
  }
}
