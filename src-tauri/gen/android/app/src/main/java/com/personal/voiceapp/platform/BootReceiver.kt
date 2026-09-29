package com.personal.voiceapp.platform

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * After reboot or an update, briefly opens MainActivity so a visible activity can start the
 * microphone foreground service (Android 14+ blocks starting it from the background).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
      return
    }
    if (!FloatingMicPrefs.wantFloatingMic(context) || !FloatingMicPrefs.startOnBoot(context)) {
      return
    }
    if (!micGranted(context) || !Settings.canDrawOverlays(context)) {
      Log.i(TAG, "Skipping boot restore: microphone or overlay permission missing")
      return
    }
    try {
      context.startActivity(FloatingMicIntents.autostartIntent(context))
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not open Personal Voice after boot", error)
    }
  }

  private fun micGranted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private companion object {
    const val TAG = "BootReceiver"
  }
}
