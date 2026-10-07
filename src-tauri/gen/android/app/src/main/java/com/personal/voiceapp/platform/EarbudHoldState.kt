package com.personal.voiceapp.platform

enum class EarbudRelease {
  IGNORE,
  QUICK_TAP,
  RELEASE_HOLD,
}

/**
 * Pure state for one headset-button gesture. Android delivery/timers stay in the service;
 * this class only decides whether release means media replay or the end of Dictation.
 */
class EarbudHoldState {
  var pendingKey: Int? = null
    private set
  var holding: Boolean = false
    private set

  /** True only for the first down of a new supported button gesture. */
  fun down(keyCode: Int): Boolean {
    if (pendingKey != null) return false
    pendingKey = keyCode
    holding = false
    return true
  }

  /** Called after the 400 ms timer. True exactly once when a pending gesture becomes Dictation. */
  fun beginHold(): Boolean {
    if (pendingKey == null || holding) return false
    holding = true
    return true
  }

  fun up(keyCode: Int): EarbudRelease {
    if (pendingKey != keyCode) return EarbudRelease.IGNORE
    pendingKey = null
    val wasHolding = holding
    holding = false
    return if (wasHolding) EarbudRelease.RELEASE_HOLD else EarbudRelease.QUICK_TAP
  }

  /** Returns whether an active Dictation hold needs a cancel event. */
  fun cancel(): Boolean {
    val wasHolding = holding
    pendingKey = null
    holding = false
    return wasHolding
  }
}
