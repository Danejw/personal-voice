package com.personal.voiceapp.platform

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
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
class LiveDictationArgs {
  lateinit var phase: String
  var text: String = ""
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
  /** `dictation` keeps recognition capture. `assistant` uses the voice-communication path. */
  var purpose: String = "dictation"
}

@InvokeArg
class AssistantPlaybackArgs {
  var data: String = ""
  var token: Int = 0
}

@InvokeArg
class CameraArgs {
  /** `default`, `front`, or `back`. */
  var facing: String = "default"
}

@InvokeArg
class StartOnBootArgs {
  var enabled: Boolean = true
}

@InvokeArg
class EnabledArgs {
  var enabled: Boolean = true
}

@InvokeArg
class DictationCueArgs {
  var kind: String = "ready"
}

/**
 * Android side of the shared `PlatformAdapter`: the floating mic, its foreground service,
 * setup helpers, and focused-field insertion. Dictation itself (capture, Gemini, settings,
 * auth) stays in the shared TypeScript running in the WebView.
 */
@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
    Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
  ],
)
class VoicePlatformPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private var webView: WebView? = null
  private var webViewWoken = false
  private var capture: NativeMicCapture? = null
  private var captureId = 0
  private var audioSession: AssistantAudioSession? = null
  private var playbackTrack: AssistantPcmTrack? = null
  private var cameraSession: AndroidCameraSession? = null
  private var pendingCamera: (() -> Unit)? = null
  private val captureBridge = object : CaptureHandle {
    override fun open(source: AudioSourceChoice, preferHeadsetInput: Boolean): Int {
      val mic = capture ?: error("Microphone capture is not ready.")
      val headset = if (preferHeadsetInput && FloatingMicPrefs.preferHeadsetMic(activity)) {
        preferredHeadsetInput(activity)
      } else {
        null
      }
      return mic.open(androidAudioSource(source), headset)
    }
    override fun start() {
      capture?.start() ?: error("Microphone capture is not ready.")
    }
    override fun stop() {
      capture?.stop()
    }
  }

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
    cameraSession?.stop()
    cameraSession = null
    audioSession?.close()
    audioSession = null
    playbackTrack = null
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
        .put("floatingMic", FloatingMicService.isRunning)
        .put("startOnBoot", FloatingMicPrefs.startOnBoot(activity))
        .put("wantFloatingMic", FloatingMicPrefs.wantFloatingMic(activity))
        .put("earbudHoldToDictate", FloatingMicPrefs.earbudHoldToDictate(activity))
        .put("preferHeadsetMic", FloatingMicPrefs.preferHeadsetMic(activity))
        .put("headsetMicAvailable", hasHeadsetInput(activity))
        .put("batteryUnrestricted", batteryUnrestricted()),
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

  /** System dialog (or list) so the floating mic is not battery-optimized. */
  @Command
  fun openBatterySettings(invoke: Invoke) {
    if (!batteryUnrestricted()) {
      try {
        open(
          invoke,
          Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}")),
        )
        return
      } catch (_: ActivityNotFoundException) {
        // Fall through to the battery-optimization list.
      }
    }
    open(invoke, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }

  @Command
  fun setStartOnBoot(invoke: Invoke) {
    val enabled = invoke.parseArgs(StartOnBootArgs::class.java).enabled
    FloatingMicPrefs.setStartOnBoot(activity, enabled)
    invoke.resolve()
  }

  @Command
  fun setEarbudHoldToDictate(invoke: Invoke) {
    val enabled = invoke.parseArgs(EnabledArgs::class.java).enabled
    FloatingMicPrefs.setEarbudHoldToDictate(activity, enabled)
    main.post { FloatingMicService.instance?.refreshEarbudControls() }
    invoke.resolve()
  }

  @Command
  fun setPreferHeadsetMic(invoke: Invoke) {
    val enabled = invoke.parseArgs(EnabledArgs::class.java).enabled
    FloatingMicPrefs.setPreferHeadsetMic(activity, enabled)
    invoke.resolve()
  }

  @Command
  fun playDictationCue(invoke: Invoke) {
    val kind = when (invoke.parseArgs(DictationCueArgs::class.java).kind) {
      "ready" -> DictationCueKind.READY
      "done" -> DictationCueKind.DONE
      else -> {
        invoke.reject("Unknown Dictation cue.")
        return
      }
    }
    DictationCuePlayer.play(kind)
    invoke.resolve()
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

  /** Lists front/rear cameras when present. Brings the app forward so permission prompts can show. */
  @Command
  fun listCameras(invoke: Invoke) {
    main.post {
      bringAppForward()
      ensureCameraPermission(invoke) {
        try {
          val session = cameraOrCreate()
          val devices = session.listDevices()
          val list = org.json.JSONArray()
          for (device in devices) {
            list.put(
              JSONObject()
                .put("id", device.id)
                .put("label", device.label)
                .put("facing", CameraFacingSelect.wireName(device.facing)),
            )
          }
          invoke.resolve(JSObject().put("devices", list))
        } catch (error: Exception) {
          invoke.reject(error.message ?: "Could not list cameras.")
        }
      }
    }
  }

  /** One still JPEG. Requires an explicit user/tool request from TypeScript. */
  @Command
  fun captureCameraPhoto(invoke: Invoke) {
    val facingRaw = invoke.parseArgs(CameraArgs::class.java).facing
    main.post {
      bringAppForward()
      ensureCameraPermission(invoke) {
        val facing = try {
          CameraFacingSelect.parse(facingRaw)
        } catch (error: Exception) {
          invoke.reject(error.message ?: "Camera must be default, front, or back.")
          return@ensureCameraPermission
        }
        try {
          cameraOrCreate().capturePhoto(facing) { result ->
            result.fold(
              onSuccess = { photo ->
                val payload = JSObject()
                  .put("jpeg", photo.jpegBase64)
                  .put("width", photo.width)
                  .put("height", photo.height)
                  .put("facing", photo.facing)
                  .put("capturedAt", isoNow())
                photo.label?.let { payload.put("label", it) }
                invoke.resolve(payload)
              },
              onFailure = { error ->
                invoke.reject(error.message ?: "Could not capture a camera photo.")
              },
            )
          }
        } catch (error: Exception) {
          invoke.reject(error.message ?: "Could not open the camera.")
        }
      }
    }
  }

  /** Starts 1 FPS JPEG frames via `cameraFrame` events. Always shows a visible preview. */
  @Command
  fun startCameraFrames(invoke: Invoke) {
    val facingRaw = invoke.parseArgs(CameraArgs::class.java).facing
    main.post {
      bringAppForward()
      ensureCameraPermission(invoke) {
        val facing = try {
          CameraFacingSelect.parse(facingRaw)
        } catch (error: Exception) {
          invoke.reject(error.message ?: "Camera must be default, front, or back.")
          return@ensureCameraPermission
        }
        try {
          cameraOrCreate().startFrames(facing)
          invoke.resolve(
            JSObject()
              .put("facing", CameraFacingSelect.wireName(facing))
              .put("active", true),
          )
        } catch (error: Exception) {
          invoke.reject(error.message ?: "Could not start Camera Context.")
        }
      }
    }
  }

  @Command
  fun switchCamera(invoke: Invoke) {
    val facingRaw = invoke.parseArgs(CameraArgs::class.java).facing
    main.post {
      bringAppForward()
      val facing = try {
        CameraFacingSelect.parse(facingRaw)
      } catch (error: Exception) {
        invoke.reject(error.message ?: "Camera must be default, front, or back.")
        return@post
      }
      try {
        val session = cameraSession ?: throw IllegalStateException("Camera Context is not active.")
        session.switchFacing(facing)
        invoke.resolve(JSObject().put("facing", session.facingWire).put("active", true))
      } catch (error: Exception) {
        invoke.reject(error.message ?: "Could not switch the camera.")
      }
    }
  }

  @Command
  fun stopCameraFrames(invoke: Invoke) {
    main.post {
      cameraSession?.stop()
      invoke.resolve(JSObject().put("active", false))
    }
  }

  private fun cameraOrCreate(): AndroidCameraSession {
    val owner = activity as? androidx.lifecycle.LifecycleOwner
      ?: error("Camera requires a lifecycle activity.")
    val existing = cameraSession
    if (existing != null) return existing
    val created = AndroidCameraSession(
      activity = activity,
      lifecycleOwner = owner,
      onFrame = { jpeg, width, height, facing, label ->
        val payload = JSObject()
          .put("jpeg", jpeg)
          .put("width", width)
          .put("height", height)
          .put("facing", facing)
          .put("capturedAt", isoNow())
        if (label != null) payload.put("label", label)
        trigger("cameraFrame", payload)
      },
      onError = { message ->
        trigger("cameraError", JSObject().put("message", message))
      },
    )
    cameraSession = created
    return created
  }

  private fun ensureCameraPermission(invoke: Invoke, onGranted: () -> Unit) {
    if (cameraGranted()) {
      onGranted()
      return
    }
    pendingCamera = onGranted
    requestPermissionForAlias("camera", invoke, "cameraPermissionResult")
  }

  @PermissionCallback
  private fun cameraPermissionResult(invoke: Invoke) {
    val pending = pendingCamera
    pendingCamera = null
    if (getPermissionState("camera") == PermissionState.GRANTED && pending != null) {
      pending()
    } else {
      invoke.reject(AndroidCameraSession.CAMERA_DENIED)
    }
  }

  private fun isoNow(): String {
    val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
    format.timeZone = java.util.TimeZone.getTimeZone("UTC")
    return format.format(java.util.Date())
  }

  private fun cameraGranted(): Boolean =
    ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

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
    val args = invoke.parseArgs(CaptureArgs::class.java)
    val id = args.id
    val purpose = capturePurpose(args.purpose)
    audioSession?.close()
    capture = null
    val event = { kind: String -> JSObject().put("id", id).put("kind", kind) }
    val next = NativeMicCapture(
      onChunk = { pcm -> emitCapture(event("chunk").put("data", Base64.encodeToString(pcm, Base64.NO_WRAP))) },
      onError = { message -> emitCapture(event("error").put("message", message)) },
      onEnd = { emitCapture(event("end")) },
    )
    capture = next
    try {
      val status = session().start(purpose)
      captureId = id
      invoke.resolve(
        JSObject()
          .put("fullDuplex", status.fullDuplex)
          .put("nativePlayback", status.nativePlayback)
          .put("noiseSuppression", status.noiseSuppression),
      )
    } catch (error: Exception) {
      audioSession?.close()
      capture = null
      invoke.reject(error.message ?: "Could not start microphone capture.")
    }
  }

  /**
   * Writes one 24 kHz PCM16 chunk to the voice-communication track opened with Assistant capture.
   * Ignored when that track is not running, so dictation never plays through it.
   */
  @Command
  fun enqueueAssistantPlayback(invoke: Invoke) {
    val args = invoke.parseArgs(AssistantPlaybackArgs::class.java)
    val pcm = try {
      Base64.decode(args.data, Base64.DEFAULT)
    } catch (_: Exception) {
      invoke.resolve()
      return
    }
    playbackTrack?.enqueue(pcm, args.token)
    invoke.resolve()
  }

  @Command
  fun clearAssistantPlayback(invoke: Invoke) {
    playbackTrack?.clear()
    invoke.resolve()
  }

  private fun session(): AssistantAudioSession {
    audioSession?.let { return it }
    val effects = AndroidCaptureEffects()
    val track = AssistantPcmTrack(::emitPlayback)
    val route = AndroidCommunicationRoute(activity) { main.post { audioSession?.reselectRoute() } }
    effects.onEchoDisabled = { main.post { audioSession?.noteRouteLost() } }
    route.onFocusLost = { main.post { audioSession?.noteRouteLost() } }
    val created = AssistantAudioSession(route, captureBridge, effects, track) { route.currentDevices() }
    created.onStatusChanged = { status -> emitDuplex(status) }
    playbackTrack = track
    audioSession = created
    return created
  }

  private fun emitPlayback(kind: String, remainingMs: Int, token: Int) {
    val payload = JSObject().put("kind", kind).put("remainingMs", remainingMs).put("token", token)
    main.post { trigger("assistantPlayback", payload) }
  }

  private fun emitDuplex(status: CaptureEchoStatus) {
    val payload = JSObject()
      .put("kind", "duplex")
      .put("fullDuplex", status.fullDuplex)
      .put("nativePlayback", status.nativePlayback)
      .put("remainingMs", 0)
      .put("token", 0)
    main.post { trigger("assistantPlayback", payload) }
  }

  /** Resolves at once; the web side waits for this capture's `end` event, which follows the last chunk. */
  @Command
  fun stopCapture(invoke: Invoke) {
    val id = invoke.parseArgs(CaptureArgs::class.java).id
    val current = capture
    if (current != null && captureId == id) {
      audioSession?.close()
      capture = null
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
  fun liveDictationText(invoke: Invoke) {
    val args = invoke.parseArgs(LiveDictationArgs::class.java)
    main.post {
      if (isAppVisible()) {
        invoke.resolve(JSObject().put("supported", false))
        return@post
      }
      val success = VoiceAccessibilityService.liveText(args.phase, args.text)
      invoke.resolve(JSObject().put("supported", success))
    }
  }

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

  private fun batteryUnrestricted(): Boolean {
    val pm = activity.getSystemService(PowerManager::class.java) ?: return false
    return pm.isIgnoringBatteryOptimizations(activity.packageName)
  }

  private companion object {
    const val MIC_DENIED = "Microphone permission was denied. Allow microphone access and try again."
    const val RELEASE_HOST = "github.com"
  }
}
