package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import androidx.core.content.ContextCompat
import com.personal.voiceapp.R
import kotlin.math.hypot
import kotlin.math.min

/**
 * The floating mic. Holding it is one utterance; moving it past a small threshold turns the
 * touch into a drag, which cancels that utterance so nothing is inserted.
 */
@SuppressLint("ViewConstructor")
class MicBubbleView(context: Context, private val callbacks: Callbacks) : View(context) {
  interface Callbacks {
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

  private val dragThreshold = ViewConfiguration.get(context).scaledTouchSlop * 3f
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val icon = ContextCompat.getDrawable(context, R.drawable.ic_mic)!!.mutate().apply {
    setTint(0xFF111820.toInt())
  }
  private var downX = 0f
  private var downY = 0f
  private var dragging = false

  init {
    contentDescription = context.getString(R.string.floating_mic_hold)
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
        isHolding = true
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        callbacks.onPress()
        invalidate()
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downX
        val dy = event.rawY - downY
        if (!dragging && hypot(dx, dy) > dragThreshold) {
          dragging = true
          isHolding = false
          callbacks.onCancel()
          callbacks.onDragStart()
          invalidate()
        }
        if (dragging) callbacks.onDragBy(dx.toInt(), dy.toInt())
      }
      MotionEvent.ACTION_UP -> {
        if (dragging) callbacks.onDragEnd() else if (isHolding) callbacks.onRelease()
        reset()
      }
      MotionEvent.ACTION_CANCEL -> {
        if (isHolding) callbacks.onCancel()
        if (dragging) callbacks.onDragEnd()
        reset()
      }
    }
    return true
  }

  private fun reset() {
    isHolding = false
    dragging = false
    invalidate()
  }
}
