package com.personal.voiceapp.platform

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.sin

enum class DictationCueKind { READY, DONE }

data class DictationCueSpec(
  val fromHz: Double,
  val toHz: Double,
  val durationMs: Int,
  val amplitude: Double,
)

fun dictationCueSpec(kind: DictationCueKind): DictationCueSpec = when (kind) {
  DictationCueKind.READY -> DictationCueSpec(640.0, 780.0, 72, 0.055)
  DictationCueKind.DONE -> DictationCueSpec(720.0, 560.0, 78, 0.050)
}

/** Native sonification so Android cues still play while the WebView is backgrounded. */
object DictationCuePlayer {
  private const val SAMPLE_RATE = 48_000

  fun play(kind: DictationCueKind) {
    Thread({
      val spec = dictationCueSpec(kind)
      val samples = render(spec)
      val track = try {
        AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .build(),
          )
          .setTransferMode(AudioTrack.MODE_STATIC)
          .setBufferSizeInBytes(samples.size * 2)
          .build()
      } catch (_: Exception) {
        return@Thread
      }

      try {
        if (track.state != AudioTrack.STATE_INITIALIZED) return@Thread
        track.write(samples, 0, samples.size)
        track.play()
        Thread.sleep((spec.durationMs + 35).toLong())
      } catch (_: Exception) {
        // Feedback is best effort and must never affect Dictation.
      } finally {
        try { track.release() } catch (_: Exception) {}
      }
    }, "dictation-cue").apply { isDaemon = true }.start()
  }

  private fun render(spec: DictationCueSpec): ShortArray {
    val count = (SAMPLE_RATE * spec.durationMs / 1000).coerceAtLeast(1)
    val out = ShortArray(count)
    var phase = 0.0
    for (index in 0 until count) {
      val progress = if (count == 1) 1.0 else index.toDouble() / (count - 1)
      val frequency = spec.fromHz + (spec.toHz - spec.fromHz) * progress
      phase += 2.0 * PI * frequency / SAMPLE_RATE
      // Sine-shaped envelope gives a soft attack and release with no click.
      val envelope = sin(PI * progress)
      out[index] = (sin(phase) * envelope * spec.amplitude * Short.MAX_VALUE).toInt().toShort()
    }
    return out
  }
}
