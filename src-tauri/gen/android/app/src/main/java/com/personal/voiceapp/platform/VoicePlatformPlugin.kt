package com.personal.voiceapp.platform

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.PermissionState
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class InsertTextArgs {
  lateinit var text: String
}

@InvokeArg
class IndicatorArgs {
  /** `idle`, `listening`, `finalizing`, or `error`. */
  lateinit var kind: String
  var message: String? = null
}

@InvokeArg
class OpenDownloadArgs {
  lateinit var url: String
}

@InvokeArg
class OverlayJsonArgs {
  lateinit var snapshot: String
}

@InvokeArg
class CaptureSelectionArgs {
  var restoreSettings: Boolean = true
}

@InvokeArg
class CaptureArgs {
  /** Chosen by the web side; tags `audioCapture` events so a late event can't reach a newer capture. */
  var id: Int = 0
}

/**
 * Android side of the shared `PlatformAdapter`: the floating mic, its foreground service,
 * setup helpers, and focused-field insertion. Dictation itself (capture, Gemini, settings,
 * auth) stays in the shared TypeScript running in the WebView.
 */
@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
  ],
)
class VoicePlatformPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private var webView: WebView? = null
  private var webViewWoken = false
  private var capture: NativeMicCapture? = null
  private var captureId = 0

  override fun load(webView: WebView) {
    this.webView = webView
    FloatingMicService.listener = object : FloatingMicService.Listener {
      override fun onPushToTalk(event: String) {
        if (event == "press") wakeWebView()
        trigger("pushToTalk", JSObject().put("event", event))
      }
      override fun onOverlayAction(payload: JSONObject) {
        wakeWebView()
        val event = JSObject()
        val keys = payload.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          event.put(key, payload.get(key))
        }
        trigger("overlayAction", event)
      }
      override fun onRunningChanged(running: Boolean) =
        trigger("floatingMicChanged", JSObject().put("running", running))
    }
  }

  /** Without the WebView nothing can answer the bubble, so the service goes with it. */
  override fun onDestroy(activity: AppCompatActivity) {
    capture?.stop()
    capture = null
    FloatingMicService.listener = null
    activity.stopService(Intent(activity, FloatingMicService::class.java))
  }

  @Command
  fun getStatus(invoke: Invoke) {
    invoke.resolve(
      JSObject()
        .put("microphone", micGranted())
        .put("notifications", NotificationManagerCompat.from(activity).areNotificationsEnabled())
        .put("overlay", Settings.canDrawOverlays(activity))
        .put("accessibility", VoiceAccessibilityService.isConnected)
        .put("floatingMic", FloatingMicService.isRunning),
    )
  }

  @Command
  fun openOverlaySettings(invoke: Invoke) {
    open(invoke, Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}")))
  }

  @Command
  fun openAccessibilitySettings(invoke: Invoke) {
    open(invoke, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
  }

  /** App info, where a denied microphone or "restricted settings" for sideloaded apps is fixed. */
  @Command
  fun openAppSettings(invoke: Invoke) {
    open(invoke, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)))
  }

  /**
   * Hands a release APK link to the browser. The download is opened by Android's package
   * installer, which asks the user and only accepts an update signed with this app's key.
   */
  @Command
  fun openDownload(invoke: Invoke) {
    val url = Uri.parse(invoke.parseArgs(OpenDownloadArgs::class.java).url)
    if (url.scheme != "https" || url.host != RELEASE_HOST) {
      invoke.reject("Updates can only be downloaded from GitHub.")
      return
    }
    try {
      open(invoke, Intent(Intent.ACTION_VIEW, url))
    } catch (_: ActivityNotFoundException) {
      invoke.reject("No browser is available to download the update.")
    }
  }

  /** Must be called while the app is visible; Android refuses to start it from the background. */
  @Command
  fun startFloatingMic(invoke: Invoke) {
    when {
      !micGranted() -> invoke.reject("Allow microphone access first.")
      !Settings.canDrawOverlays(activity) ->
        invoke.reject("Allow Personal Voice to display over other apps first.")
      else -> {
        ContextCompat.startForegroundService(activity, Intent(activity, FloatingMicService::class.java))
        invoke.resolve()
      }
    }
  }

  @Command
  fun stopFloatingMic(invoke: Invoke) {
    activity.stopService(Intent(activity, FloatingMicService::class.java))
    invoke.resolve()
  }

  @Command
  fun setIndicator(invoke: Invoke) {
    val args = invoke.parseArgs(IndicatorArgs::class.java)
    val state = when (args.kind) {
      "listening" -> MicBubbleView.State.LISTENING
      "finalizing" -> MicBubbleView.State.FINALIZING
      "error" -> MicBubbleView.State.ERROR
      else -> MicBubbleView.State.IDLE
    }
    main.post {
      FloatingMicService.instance?.showState(state)
      if (state == MicBubbleView.State.IDLE) sleepWebView()
      val message = args.message
      if (state == MicBubbleView.State.ERROR && message != null && !isAppVisible()) {
        Toast.makeText(activity.applicationContext, message, Toast.LENGTH_LONG).show()
      }
    }
    invoke.resolve()
  }

  @Command
  fun setOverlay(invoke: Invoke) {
    val json = invoke.parseArgs(OverlayJsonArgs::class.java).snapshot
    main.post {
      FloatingMicService.instance?.showSnapshot(json)
      val parsed = try { JSONObject(json) } catch (_: Exception) { JSONObject() }
      val dictation = parsed.optString("dictation", "idle")
      val assistant = parsed.optString("assistant", "idle")
      val assistantLive = assistant == "listening" || assistant == "responding"
      if (assistantLive) wakeWebView()
      if (dictation == "idle" && !assistantLive) sleepWebView()
      val message = parsed.optString("error")
      if (dictation == "error" && message.isNotEmpty() && !isAppVisible()) {
        Toast.makeText(activity.applicationContext, message, Toast.LENGTH_LONG).show()
      }
      val assistantError = parsed.optString("assistantError")
      if (assistant == "error" && assistantError.isNotEmpty() && !isAppVisible()) {
        Toast.makeText(activity.applicationContext, assistantError, Toast.LENGTH_LONG).show()
      }
    }
    invoke.resolve()
  }

  @Command
  fun showSettings(invoke: Invoke) {
    main.post {
      bringAppForward()
      invoke.resolve()
    }
  }

  /**
   * Starts streaming `audioCapture` events: `chunk` (base64 PCM), `error`, and finally `end`.
   * Asks for the microphone first when the app is on screen; from the floating mic it must already be granted.
   */
  @Command
  fun startCapture(invoke: Invoke) {
    when {
      micGranted() -> beginCapture(invoke)
      isAppVisible() -> requestPermissionForAlias("microphone", invoke, "captureAfterPermission")
      else -> invoke.reject(MIC_DENIED)
    }
  }

  @PermissionCallback
  private fun captureAfterPermission(invoke: Invoke) {
    if (getPermissionState("microphone") == PermissionState.GRANTED) beginCapture(invoke) else invoke.reject(MIC_DENIED)
  }

  private fun beginCapture(invoke: Invoke) {
    val id = invoke.parseArgs(CaptureArgs::class.java).id
    capture?.stop()
    val event = { kind: String -> JSObject().put("id", id).put("kind", kind) }
    val next = NativeMicCapture(
      onChunk = { pcm -> emitCapture(event("chunk").put("data", Base64.encodeToString(pcm, Base64.NO_WRAP))) },
      onError = { message -> emitCapture(event("error").put("message", message)) },
      onEnd = { emitCapture(event("end")) },
    )
    try {
      next.start()
    } catch (error: Exception) {
      capture = null
      invoke.reject(error.message ?: "Could not start microphone capture.")
      return
    }
    capture = next
    captureId = id
    invoke.resolve()
  }

  /** Resolves at once; the web side waits for this capture's `end` event, which follows the last chunk. */
  @Command
  fun stopCapture(invoke: Invoke) {
    val id = invoke.parseArgs(CaptureArgs::class.java).id
    val current = capture
    if (current != null && captureId == id) {
      capture = null
      current.stop()
    } else {
      emitCapture(JSObject().put("id", id).put("kind", "end"))
    }
    invoke.resolve()
  }

  /** Posted to the main thread so capture events keep their order with everything else the plugin sends. */
  private fun emitCapture(payload: JSObject) {
    main.post { trigger("audioCapture", payload) }
  }

  private fun micGranted(): Boolean =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  @Command
  fun insertText(invoke: Invoke) {
    val text = invoke.parseArgs(InsertTextArgs::class.java).text
    main.post {
      // Dictating inside this app: the transcript is already shown on screen.
      if (isAppVisible()) {
        invoke.resolve()
        return@post
      }
      when (val result = VoiceAccessibilityService.insert(activity.applicationContext, text)) {
        is InsertResult.Typed -> resolveTarget(invoke, result)
        is InsertResult.Failed -> invoke.reject(result.message)
      }
    }
  }

  /** Returns to the previous app before asking the accessibility service to insert a handoff. */
  @Command
  fun insertHandoffText(invoke: Invoke) {
    val text = invoke.parseArgs(InsertTextArgs::class.java).text
    main.post {
      if (!activity.moveTaskToBack(true)) {
        invoke.reject("Could not return to the previous app.")
        return@post
      }
      main.postDelayed({
        when (val result = VoiceAccessibilityService.insert(activity.applicationContext, text)) {
          is InsertResult.Typed -> resolveTarget(invoke, result)
          is InsertResult.Failed -> invoke.reject(result.message)
        }
      }, 250)
    }
  }

  /** Returns to the previous app, reads its focused selection, then optionally brings Settings back. */
  @Command
  fun captureSelection(invoke: Invoke) {
    val restore = invoke.parseArgs(CaptureSelectionArgs::class.java).restoreSettings
    main.post {
      fun finish() {
        val result = VoiceAccessibilityService.capture()
        if (restore) bringAppForward()
        when (result) {
          is CaptureResult.Captured -> {
            val payload = JSObject().put("text", result.text)
            result.sourceApp?.let { payload.put("sourceApp", it) }
            invoke.resolve(payload)
          }
          is CaptureResult.Failed -> invoke.reject(result.message)
        }
      }
      if (!isAppVisible()) {
        finish()
        return@post
      }
      if (!activity.moveTaskToBack(true)) {
        invoke.reject("Could not return to the previous app.")
        return@post
      }
      main.postDelayed({ finish() }, 250)
    }
  }

  /** One MediaProjection frame. Accessibility is not used. */
  @Command
  fun captureSnapshot(invoke: Invoke) {
    val host = activity
    if (host == null) {
      invoke.reject("Couldn't capture the screen.")
      return
    }
    host.runOnUiThread {
      ScreenSnapshotCapture.begin(host) { jpeg, error ->
        if (jpeg == null) {
          invoke.reject(error ?: "Couldn't capture the screen.")
        } else {
          invoke.resolve(JSObject().put("source", "screen").put("jpeg", jpeg))
        }
      }
    }
  }

  /** Resolves the receiving app, or nothing when the paste could not be named. */
  private fun resolveTarget(invoke: Invoke, result: InsertResult.Typed) {
    val id = result.appId
    if (id.isNullOrBlank()) {
      invoke.resolve()
      return
    }
    invoke.resolve(JSObject().put("id", id).put("label", result.appLabel ?: id))
  }

  /** Puts Settings in front again so the capture preview is visible. */
  private fun bringAppForward() {
    val intent = Intent(activity, activity.javaClass).apply {
      flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    activity.startActivity(intent)
  }

  /**
   * While the app is hidden, Chromium treats the page as hidden: it throttles timers at first and
   * freezes timers and message tasks after a few minutes, which would stall the shared dictation code
   * mid-utterance. For the length of one dictation the WebView is told its window is visible again.
   */
  private fun wakeWebView() {
    if (isAppVisible()) return
    val view = webView ?: return
    view.onResume()
    view.dispatchWindowVisibilityChanged(View.VISIBLE)
    webViewWoken = true
  }

  /** Hands the WebView back to the activity's real visibility once dictation is idle again. */
  private fun sleepWebView() {
    if (!webViewWoken) return
    webViewWoken = false
    if (isAppVisible()) return
    val view = webView ?: return
    view.dispatchWindowVisibilityChanged(view.windowVisibility)
    view.onPause()
  }

  private fun isAppVisible(): Boolean =
    (activity as? AppCompatActivity)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true

  private fun open(invoke: Invoke, intent: Intent) {
    activity.startActivity(intent)
    invoke.resolve()
  }

  private companion object {
    const val MIC_DENIED = "Microphone permission was denied. Allow microphone access and try again."
    const val RELEASE_HOST = "github.com"
  }
}
