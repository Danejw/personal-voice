package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioRecord

/**
 * 16 kHz mono 16-bit PCM from the microphone in 100 ms chunks, matching the shared
 * `PCM_SAMPLE_RATE`/`PCM_CHUNK_SAMPLES`. Native rather than `getUserMedia` because the
 * WebView's permission flow waits for the activity, which is hidden while the floating mic is used.
 *
 * Dictation uses `VOICE_RECOGNITION`. Assistant uses `VOICE_COMMUNICATION` so the platform
 * can cancel echo from voice-communication playback. The source is chosen by the caller.
 *
 * Callbacks run on the capture thread. After `stop`, the final partial chunk (if any) and then
 * `onEnd` are delivered; nothing is delivered after `onEnd`.
 */
class NativeMicCapture(
  private val onChunk: (ByteArray) -> Unit,
  private val onError: (String) -> Unit,
  private val onEnd: () -> Unit,
) {
  @Volatile private var running = false
  private var started = false
  private var record: AudioRecord? = null

  /**
   * Creates the recorder and returns its audio session id so effects can be attached
   * before [start]. The caller must hold `RECORD_AUDIO`.
   */
  @SuppressLint("MissingPermission")
  fun open(source: Int, preferredInput: AudioDeviceInfo? = null): Int {
    val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
    if (minBuffer <= 0) throw IllegalStateException("This phone can't record 16 kHz audio.")
    val next = AudioRecord(source, SAMPLE_RATE, CHANNEL, ENCODING, maxOf(minBuffer, CHUNK_BYTES * 4))
    if (next.state != AudioRecord.STATE_INITIALIZED) {
      next.release()
      throw IllegalStateException(BUSY)
    }
    // This is a preference, not a hard dependency. If the headset vanishes or Android
    // rejects the route, capture continues on the system-selected microphone.
    if (preferredInput != null) {
      try { next.setPreferredDevice(preferredInput) } catch (_: Exception) {}
    }
    record = next
    return next.audioSessionId
  }

  /** Starts the read loop. Effects for this session must already be attached. */
  fun start() {
    val active = record ?: throw IllegalStateException(BUSY)
    active.startRecording()
    if (active.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      active.release()
      record = null
      throw IllegalStateException(BUSY)
    }
    running = true
    started = true
    Thread({ pump(active) }, "voice-mic").start()
  }

  /**
   * Returns immediately. The capture thread finishes the current chunk, then calls `onEnd`.
   * If the read loop never started, the recorder is released here so a failed start cannot leak it.
   */
  fun stop() {
    running = false
    if (started) return
    val active = record
    record = null
    try { active?.release() } catch (_: Exception) {}
  }

  private fun pump(active: AudioRecord) {
    val buffer = ByteArray(CHUNK_BYTES)
    var filled = 0
    try {
      while (running) {
        val read = active.read(buffer, filled, CHUNK_BYTES - filled)
        if (read < 0) {
          running = false
          onError("Audio capture stopped unexpectedly. Try recording again.")
          return
        }
        filled += read
        if (filled == CHUNK_BYTES) {
          onChunk(buffer.copyOf())
          filled = 0
        }
      }
      if (filled > 0) onChunk(buffer.copyOf(filled))
    } finally {
      try { active.stop() } catch (_: Exception) {}
      try { active.release() } catch (_: Exception) {}
      if (record === active) record = null
      onEnd()
    }
  }

  private companion object {
    const val SAMPLE_RATE = 16_000
    const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
    const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    const val CHUNK_BYTES = 1_600 * 2
    const val BUSY = "The microphone is busy or unavailable."
  }
}
