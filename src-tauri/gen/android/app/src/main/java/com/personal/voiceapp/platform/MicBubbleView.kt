package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.core.content.ContextCompat
import com.personal.voiceapp.R
import kotlin.math.hypot
import kotlin.math.min

/**
 * The floating mic. A short tap opens quick actions. Holding past [HOLD_MS] is one
 * utterance; moving it past a small threshold turns the touch into a drag, which
 * cancels that utterance so nothing is inserted.
 */
@SuppressLint("ViewConstructor")
class MicBubbleView(
  context: Context,
  private val callbacks: Callbacks,
  @DrawableRes iconRes: Int = R.drawable.ic_mic,
  @StringRes descriptionRes: Int = R.string.floating_mic_hold,
) : View(context) {
  interface Callbacks {
    fun onTap()
    fun onPress()
    fun onRelease()
    fun onCancel()
    fun onDragStart()
    /** Total movement since the finger went down, in pixels. */
    fun onDragBy(dx: Int, dy: Int)
    fun onDragEnd()
  }

  enum class State(val color: Int) {
    IDLE(0xFF88D8C1.toInt()),
    LISTENING(0xFFE76F51.toInt()),
    FINALIZING(0xFFE9C46A.toInt()),
    ERROR(0xFFF3A7A7.toInt()),
  }

  var state = State.IDLE
    set(value) {
      field = value
      invalidate()
    }

  var isHolding = false
    private set

  private val holdHandler = Handler(Looper.getMainLooper())
  private val dragThreshold = ViewConfiguration.get(context).scaledTouchSlop * 3f
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val icon = ContextCompat.getDrawable(context, iconRes)!!.mutate().apply {
    setTint(0xFF111820.toInt())
  }
  private var downX = 0f
  private var downY = 0f
  private var dragging = false
  private var holdStarted = false
  private val beginHold = Runnable {
    holdStarted = true
    isHolding = true
    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    callbacks.onPress()
    invalidate()
  }

  init {
    contentDescription = context.getString(descriptionRes)
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
        holdHandler.postDelayed(beginHold, HOLD_MS)
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
          else -> callbacks.onTap()
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

  companion object {
    const val HOLD_MS = 400L
  }
}
