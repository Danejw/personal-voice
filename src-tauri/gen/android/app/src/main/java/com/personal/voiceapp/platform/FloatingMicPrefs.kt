package com.personal.voiceapp.platform

import android.content.Context
import android.content.Intent

/**
 * Local persistence for the floating-mic session: whether the user wants it on, and whether
 * boot should restore it. Same prefs file as the bubble position in [FloatingMicService].
 */
object FloatingMicPrefs {
  const val PREFS = "floating_mic"
  private const val WANT_FLOATING_MIC = "want_floating_mic"
  private const val START_ON_BOOT = "start_on_boot"
  private const val EARBUD_HOLD_TO_DICTATE = "earbud_hold_to_dictate"
  private const val PREFER_HEADSET_MIC = "prefer_headset_mic"

  fun wantFloatingMic(context: Context): Boolean =
    prefs(context).getBoolean(WANT_FLOATING_MIC, false)

  fun setWantFloatingMic(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(WANT_FLOATING_MIC, enabled).apply()
  }

  /** Default on — matches the personal always-on / start-with-phone goal. */
  fun startOnBoot(context: Context): Boolean =
    prefs(context).getBoolean(START_ON_BOOT, true)

  fun setStartOnBoot(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(START_ON_BOOT, enabled).apply()
  }

  /** Personal Voice owns supported headset media buttons while the floating service is running. */
  fun earbudHoldToDictate(context: Context): Boolean =
    prefs(context).getBoolean(EARBUD_HOLD_TO_DICTATE, true)

  fun setEarbudHoldToDictate(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(EARBUD_HOLD_TO_DICTATE, enabled).apply()
  }

  /** Prefer a connected headset microphone for Dictation, with automatic phone-mic fallback. */
  fun preferHeadsetMic(context: Context): Boolean =
    prefs(context).getBoolean(PREFER_HEADSET_MIC, true)

  fun setPreferHeadsetMic(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(PREFER_HEADSET_MIC, enabled).apply()
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** Intent extras and one-shot flags so boot / wake can start the activity before the plugin loads. */
object FloatingMicIntents {
  const val EXTRA_AUTOSTART = "com.personal.voiceapp.EXTRA_AUTOSTART"
  const val EXTRA_WAKE_WEBVIEW = "com.personal.voiceapp.EXTRA_WAKE_WEBVIEW"

  @Volatile
  private var pendingAutostart = false

  @Volatile
  private var pendingWake = false

  fun stashFrom(intent: Intent?) {
    if (intent == null) return
    if (intent.getBooleanExtra(EXTRA_AUTOSTART, false)) {
      pendingAutostart = true
      intent.removeExtra(EXTRA_AUTOSTART)
    }
    if (intent.getBooleanExtra(EXTRA_WAKE_WEBVIEW, false)) {
      pendingWake = true
      intent.removeExtra(EXTRA_WAKE_WEBVIEW)
    }
  }

  fun takeAutostart(): Boolean {
    val value = pendingAutostart
    pendingAutostart = false
    return value
  }

  fun takeWake(): Boolean {
    val value = pendingWake
    pendingWake = false
    return value
  }

  fun autostartIntent(context: Context): Intent =
    Intent(context, com.personal.voiceapp.MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_SINGLE_TOP or
        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      putExtra(EXTRA_AUTOSTART, true)
    }

  fun wakeIntent(context: Context): Intent =
    Intent(context, com.personal.voiceapp.MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_SINGLE_TOP or
        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      putExtra(EXTRA_WAKE_WEBVIEW, true)
    }
}
