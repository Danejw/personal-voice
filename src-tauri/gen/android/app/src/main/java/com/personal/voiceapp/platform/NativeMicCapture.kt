package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/**
 * 16 kHz mono 16-bit PCM from the microphone in 100 ms chunks, matching the shared
 * `PCM_SAMPLE_RATE`/`PCM_CHUNK_SAMPLES`. Native rather than `getUserMedia` because the
 * WebView's permission flow waits for the activity, which is hidden while the floating mic is used.
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

  /** The caller must hold `RECORD_AUDIO`. Throws with a user-facing message when the mic can't start. */
  @SuppressLint("MissingPermission")
  fun start() {
    val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
    if (minBuffer <= 0) throw IllegalStateException("This phone can't record 16 kHz audio.")
    val record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, CHANNEL, ENCODING, maxOf(minBuffer, CHUNK_BYTES * 4))
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw IllegalStateException(BUSY)
    }
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      record.release()
      throw IllegalStateException(BUSY)
    }
    running = true
    Thread({ pump(record) }, "voice-mic").start()
  }

  /** Returns immediately; the capture thread finishes the current chunk, then calls `onEnd`. */
  fun stop() {
    running = false
  }

  private fun pump(record: AudioRecord) {
    val buffer = ByteArray(CHUNK_BYTES)
    var filled = 0
    try {
      while (running) {
        val read = record.read(buffer, filled, CHUNK_BYTES - filled)
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
      record.stop()
      record.release()
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
