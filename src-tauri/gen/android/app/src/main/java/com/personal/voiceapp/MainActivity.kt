package com.personal.voiceapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import com.personal.voiceapp.platform.FloatingMicIntents

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    FloatingMicIntents.stashFrom(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    FloatingMicIntents.stashFrom(intent)
  }
}
