package com.personal.voiceapp.platform

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.ArrayDeque

fun androidAudioSource(source: AudioSourceChoice): Int = when (source) {
  AudioSourceChoice.VOICE_RECOGNITION -> MediaRecorder.AudioSource.VOICE_RECOGNITION
  AudioSourceChoice.VOICE_COMMUNICATION -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
}

fun voiceCommunicationAttributes(): AudioAttributes =
  AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

/**
 * Loaded only on API 26 and newer. `AudioFocusRequest` is not on API 24–25, so the
 * communication route keeps that type out of its own fields and methods.
 */
private object CommunicationFocus {
  fun request(
    audio: AudioManager,
    listener: AudioManager.OnAudioFocusChangeListener,
    attributes: AudioAttributes,
  ): Any? {
    val request = android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(attributes)
      .setOnAudioFocusChangeListener(listener)
      .build()
    if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return null
    return request
  }

  fun abandon(audio: AudioManager, request: Any) {
    audio.abandonAudioFocusRequest(request as android.media.AudioFocusRequest)
  }
}

/**
 * Puts the process in communication mode, requests focus, and routes to the headset
 * or loudspeaker. `restore` returns the mode and device selection this session changed.
 */
class AndroidCommunicationRoute(
  context: Context,
  private val onDevicesChanged: () -> Unit,
) : RouteHandle {
  private val audio = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  private var savedMode: Int? = null
  private var savedSpeaker: Boolean? = null
  /** Holds an `AudioFocusRequest` without naming that class here, so API 24–25 can still load this route. */
  private var focusRequest: Any? = null
  private var legacyFocus = false
  private var deviceSet = false
  private var scoStarted = false
  private var selected: CommDeviceKind? = null
  private var callback: AudioDeviceCallback? = null
  private var routing = false
  var onFocusLost: (() -> Unit)? = null

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS) onFocusLost?.invoke()
  }

  override fun isOpen(): Boolean = savedMode != null

  override fun apply(device: CommDeviceKind): Boolean {
    routing = true
    try {
      if (savedMode == null) {
        savedMode = audio.mode
        savedSpeaker = if (Build.VERSION.SDK_INT < 31) {
          @Suppress("DEPRECATION")
          audio.isSpeakerphoneOn
        } else {
          null
        }
      }
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      if (!requestFocus() || !selectDevice(device) || audio.mode != AudioManager.MODE_IN_COMMUNICATION) {
        restore()
        return false
      }
      registerCallback()
      return true
    } catch (_: Exception) {
      restore()
      return false
    } finally {
      routing = false
    }
  }

  override fun reselect(): Boolean {
    if (!isOpen() || routing) return true
    val device = preferredCommunicationDevice(currentDevices()) ?: return true
    if (device == selected) return true
    routing = true
    try {
      return selectDevice(device)
    } catch (_: Exception) {
      return false
    } finally {
      routing = false
    }
  }

  override fun restore() {
    if (savedMode == null && focusRequest == null && !legacyFocus && !deviceSet && !scoStarted && callback == null) return
    unregisterCallback()
    clearDevice()
    abandonFocus()
    val speaker = savedSpeaker
    val mode = savedMode
    savedSpeaker = null
    savedMode = null
    selected = null
    if (speaker != null && Build.VERSION.SDK_INT < 31) {
      try {
        @Suppress("DEPRECATION")
        audio.isSpeakerphoneOn = speaker
      } catch (_: Exception) {}
    }
    if (mode != null) {
      try { audio.mode = mode } catch (_: Exception) {}
    }
  }

  fun currentDevices(): List<CommDeviceKind> {
    val types = if (Build.VERSION.SDK_INT >= 31) {
      audio.availableCommunicationDevices.map { it.type }
    } else {
      audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
    }
    val kinds = types.map { kindOf(it) }.distinct().toMutableList()
    if (kinds.none { it == CommDeviceKind.BUILTIN_SPEAKER }) kinds.add(CommDeviceKind.BUILTIN_SPEAKER)
    return kinds
  }

  private fun selectDevice(device: CommDeviceKind): Boolean {
    val ok = if (Build.VERSION.SDK_INT >= 31) selectCommunicationDevice(device) else selectLegacyDevice(device)
    if (ok) selected = device
    return ok
  }

  private fun selectCommunicationDevice(device: CommDeviceKind): Boolean {
    if (Build.VERSION.SDK_INT < 31) return false
    val match = audio.availableCommunicationDevices.firstOrNull { kindOf(it.type) == device } ?: return false
    val accepted = audio.setCommunicationDevice(match)
    deviceSet = accepted
    return accepted
  }

  @Suppress("DEPRECATION")
  private fun selectLegacyDevice(device: CommDeviceKind): Boolean {
    return when (device) {
      CommDeviceKind.BUILTIN_SPEAKER -> {
        stopSco()
        audio.isSpeakerphoneOn = true
        true
      }
      CommDeviceKind.BLE_HEADSET, CommDeviceKind.BLUETOOTH_SCO -> {
        audio.isSpeakerphoneOn = false
        startSco()
      }
      CommDeviceKind.WIRED_HEADSET, CommDeviceKind.USB_HEADSET -> {
        stopSco()
        audio.isSpeakerphoneOn = false
        true
      }
      CommDeviceKind.EARPIECE, CommDeviceKind.OTHER -> false
    }
  }

  @Suppress("DEPRECATION")
  private fun startSco(): Boolean {
    return try {
      audio.startBluetoothSco()
      audio.isBluetoothScoOn = true
      scoStarted = true
      true
    } catch (_: Exception) {
      false
    }
  }

  @Suppress("DEPRECATION")
  private fun stopSco() {
    if (!scoStarted) return
    scoStarted = false
    try { audio.isBluetoothScoOn = false } catch (_: Exception) {}
    try { audio.stopBluetoothSco() } catch (_: Exception) {}
  }

  private fun clearDevice() {
    if (Build.VERSION.SDK_INT >= 31 && deviceSet) {
      try { audio.clearCommunicationDevice() } catch (_: Exception) {}
    }
    deviceSet = false
    stopSco()
  }

  private fun requestFocus(): Boolean {
    val attributes = voiceCommunicationAttributes()
    if (Build.VERSION.SDK_INT >= 26) {
      val request = CommunicationFocus.request(audio, focusListener, attributes) ?: return false
      focusRequest = request
      return true
    }
    @Suppress("DEPRECATION")
    val granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    legacyFocus = granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return legacyFocus
  }

  private fun abandonFocus() {
    val request = focusRequest
    focusRequest = null
    if (request != null && Build.VERSION.SDK_INT >= 26) {
      try { CommunicationFocus.abandon(audio, request) } catch (_: Exception) {}
    }
    if (legacyFocus) {
      legacyFocus = false
      try {
        @Suppress("DEPRECATION")
        audio.abandonAudioFocus(focusListener)
      } catch (_: Exception) {}
    }
  }

  private fun registerCallback() {
    if (callback != null) return
    val next = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = onDevicesChanged()
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = onDevicesChanged()
    }
    callback = next
    audio.registerAudioDeviceCallback(next, main)
  }

  private fun unregisterCallback() {
    val current = callback ?: return
    callback = null
    try { audio.unregisterAudioDeviceCallback(current) } catch (_: Exception) {}
  }
}

/** Attaches AEC and noise suppression to one capture session and records whether each stayed enabled. */
class AndroidCaptureEffects : EffectsHandle {
  private val held = mutableListOf<AudioEffect>()
  var onEchoDisabled: (() -> Unit)? = null

  override fun attach(sessionId: Int): AttachedEffects {
    release()
    if (sessionId == 0) return AttachedEffects(inactive(), inactive())
    val echo = attachEcho(sessionId)
    val noise = attachNoise(sessionId)
    return AttachedEffects(echo, noise)
  }

  override fun release() {
    val effects = held.toList()
    held.clear()
    for (effect in effects) {
      try { effect.enabled = false } catch (_: Exception) {}
      try { effect.release() } catch (_: Exception) {}
    }
  }

  private fun attachEcho(sessionId: Int): EffectProbe {
    if (!AcousticEchoCanceler.isAvailable()) return inactive()
    val effect = try { AcousticEchoCanceler.create(sessionId) } catch (_: Exception) { null } ?: return EffectProbe(true, false, false)
    held.add(effect)
    val enabled = enable(effect)
    effect.setEnableStatusListener { _, now ->
      if (!now) onEchoDisabled?.invoke()
    }
    return EffectProbe(available = true, created = true, enabled = enabled)
  }

  private fun attachNoise(sessionId: Int): EffectProbe {
    if (!NoiseSuppressor.isAvailable()) return inactive()
    val effect = try { NoiseSuppressor.create(sessionId) } catch (_: Exception) { null } ?: return EffectProbe(true, false, false)
    held.add(effect)
    return EffectProbe(available = true, created = true, enabled = enable(effect))
  }

  private fun enable(effect: AudioEffect): Boolean {
    if (!effect.enabled) {
      try { effect.enabled = true } catch (_: Exception) {}
    }
    return try { effect.enabled } catch (_: Exception) { false }
  }

  private fun inactive() = EffectProbe(available = false, created = false, enabled = false)
}

/**
 * Streams 24 kHz PCM16 on the voice-communication output, which is the reference
 * the platform echo canceller subtracts from the microphone.
 */
class AssistantPcmTrack(
  private val onUpdate: (kind: String, remainingMs: Int, token: Int) -> Unit,
) : PlaybackHandle {
  private val lock = Object()
  private val queue = ArrayDeque<ByteArray>()
  private var track: AudioTrack? = null
  private var thread: Thread? = null
  private var running = false
  private var framesWritten = 0L
  private var token = 0

  override fun open(): Boolean {
    close()
    val min = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) return false
    val built = try {
      AudioTrack.Builder()
        .setAudioAttributes(voiceCommunicationAttributes())
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build(),
        )
        .setBufferSizeInBytes(maxOf(min, SAMPLE_RATE / 5 * 2))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    } catch (_: Exception) {
      return false
    }
    if (built.state != AudioTrack.STATE_INITIALIZED) {
      built.release()
      return false
    }
    try {
      built.play()
    } catch (_: Exception) {
      built.release()
      return false
    }
    if (built.playState != AudioTrack.PLAYSTATE_PLAYING) {
      built.release()
      return false
    }
    track = built
    running = true
    framesWritten = 0
    thread = Thread(::pump, "assistant-playback").also {
      it.isDaemon = true
      it.start()
    }
    return true
  }

  fun enqueue(pcm: ByteArray, nextToken: Int) {
    if (pcm.isEmpty() || track == null) return
    synchronized(lock) {
      token = nextToken
      queue.add(pcm)
      lock.notifyAll()
    }
  }

  override fun clear() {
    val active = track ?: return
    val current = synchronized(lock) {
      queue.clear()
      try {
        active.pause()
        active.flush()
        active.play()
        framesWritten = head(active)
      } catch (_: Exception) {}
      lock.notifyAll()
      token
    }
    onUpdate("cleared", 0, current)
  }

  override fun close() {
    running = false
    synchronized(lock) {
      queue.clear()
      lock.notifyAll()
    }
    thread?.join(400)
    thread = null
    val active = track
    track = null
    framesWritten = 0
    if (active != null) {
      try { active.pause() } catch (_: Exception) {}
      try { active.flush() } catch (_: Exception) {}
      try { active.release() } catch (_: Exception) {}
    }
  }

  private fun pump() {
    val active = track ?: return
    try {
      while (running) {
        val pcm = synchronized(lock) {
          while (running && queue.isEmpty()) lock.wait()
          if (!running || queue.isEmpty()) return
          queue.removeFirst()
        }
        var offset = 0
        while (running && offset < pcm.size) {
          val wrote = active.write(pcm, offset, pcm.size - offset)
          if (wrote < 0) return
          offset += wrote
          synchronized(lock) { framesWritten += wrote / 2 }
        }
        publish()
        while (running && synchronized(lock) { queue.isEmpty() }) {
          val left = remainingMs()
          val current = synchronized(lock) { token }
          if (left <= 0) {
            onUpdate("drained", 0, current)
            break
          }
          onUpdate("remaining", left, current)
          Thread.sleep(40)
        }
      }
    } catch (_: Exception) {
      // The track was released. The session treats a later write as silence.
    }
  }

  private fun publish() {
    val left = remainingMs()
    val current = synchronized(lock) { token }
    onUpdate(if (left <= 0) "drained" else "remaining", left, current)
  }

  private fun remainingMs(): Int {
    val active = track ?: return 0
    val (queuedFrames, written) = synchronized(lock) {
      val bytes = queue.sumOf { it.size }
      (bytes / 2) to framesWritten
    }
    val left = (written - head(active)).coerceAtLeast(0) + queuedFrames
    return ((left * 1000L) / SAMPLE_RATE).toInt()
  }

  private fun head(active: AudioTrack): Long = active.playbackHeadPosition.toLong() and 0xffffffffL

  private companion object {
    const val SAMPLE_RATE = 24_000
  }
}

private fun kindOf(type: Int): CommDeviceKind {
  if (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET) return CommDeviceKind.BLE_HEADSET
  if (Build.VERSION.SDK_INT >= 26 && type == AudioDeviceInfo.TYPE_USB_HEADSET) return CommDeviceKind.USB_HEADSET
  return when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> CommDeviceKind.BLUETOOTH_SCO
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> CommDeviceKind.WIRED_HEADSET
    AudioDeviceInfo.TYPE_USB_DEVICE -> CommDeviceKind.USB_HEADSET
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> CommDeviceKind.BUILTIN_SPEAKER
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> CommDeviceKind.EARPIECE
    else -> CommDeviceKind.OTHER
  }
}
