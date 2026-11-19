package com.personal.voiceapp.platform

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Experimental on-device speaker embeddings, independent of Gemini transcription.
 * No microphone is opened here: only explicit PCM from an existing dictation capture
 * is evaluated. The model loads lazily off the UI thread.
 */
internal class AndroidSpeakerEngine(private val context: Context) {
  companion object {
    const val MODEL = "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx"
    const val MODEL_ID = "sherpa-onnx-2.0.1/3dspeaker-eres2net-en-voxceleb/sha256-c4947caf150b8502"
    private const val RATE = 16_000
    private const val MIN_SAMPLES = RATE * 3
    private const val MAX_SAMPLES = RATE * 8
  }

  private var extractor: SpeakerEmbeddingExtractor? = null

  @Synchronized
  fun embed(pcm: ByteArray): FloatArray {
    require(pcm.size % 2 == 0 && pcm.size / 2 in MIN_SAMPLES..MAX_SAMPLES) {
      "Speak clearly for 3 to 8 seconds to identify your voice."
    }
    val samples = FloatArray(pcm.size / 2)
    var squared = 0.0
    var clipped = 0
    for (i in samples.indices) {
      val low = pcm[2 * i].toInt() and 0xff
      val high = pcm[2 * i + 1].toInt()
      val signed = ((high shl 8) or low).toShort().toInt()
      samples[i] = signed / 32768f
      squared += samples[i] * samples[i]
      if (kotlin.math.abs(signed) > 32600) clipped++
    }
    val rms = kotlin.math.sqrt(squared / samples.size)
    require(rms >= 0.008 && clipped * 100 < samples.size) {
      "The voice sample is too quiet or distorted. Use a quieter location."
    }

    val model = extractor ?: SpeakerEmbeddingExtractor(
      assetManager = context.assets,
      config = SpeakerEmbeddingExtractorConfig(
        model = MODEL,
        numThreads = 2,
        debug = false,
        provider = "cpu",
      ),
    ).also { extractor = it }

    val stream = model.createStream()
    try {
      stream.acceptWaveform(samples, RATE)
      stream.inputFinished()
      require(model.isReady(stream)) { "The voice sample is not ready for recognition." }
      val result = model.compute(stream)
      require(result.size == model.dim() && result.all { it.isFinite() }) {
        "The speaker model returned an invalid embedding."
      }
      return result
    } finally {
      stream.release()
    }
  }

  @Synchronized
  fun release() {
    extractor?.release()
    extractor = null
  }
}

/**
 * Account-isolated local biometric store. Android Keystore owns an AES-256-GCM key;
 * only encrypted per-account snapshots are written to app-private storage.
 * No raw audio is saved or synced. The authenticated TS app controls enrollment.
 */
internal class AndroidSpeakerVault(private val context: Context) {
  companion object {
    private const val ALIAS = "personal-voice-speaker-v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val MAX_PAYLOAD = 2 * 1024 * 1024
  }

  private val mutex = Any()
  private val keystore by lazy {
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  }

  private fun key(): SecretKey {
    val existing = keystore.getKey(ALIAS, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private fun file(accountId: String): AtomicFile {
    require(accountId.isNotBlank() && accountId.length <= 256) { "Invalid signed-in account." }
    val hash = MessageDigest.getInstance("SHA-256")
      .digest(accountId.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    val dir = File(context.noBackupFilesDir, "speaker-profiles")
    if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("Cannot create encrypted speaker storage.")
    return AtomicFile(File(dir, "$hash.bin"))
  }

  fun read(accountId: String): String? = synchronized(mutex) {
    val stored = file(accountId)
    if (!stored.baseFile.exists()) return@synchronized null
    val data = stored.readFully()
    require(data.size in 29..MAX_PAYLOAD) { "Invalid encrypted voice profile." }
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
    cipher.updateAAD(accountId.toByteArray(Charsets.UTF_8))
    String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
  }

  fun write(accountId: String, value: String) = synchronized(mutex) {
    val plain = value.toByteArray(Charsets.UTF_8)
    require(plain.size in 1..MAX_PAYLOAD) { "Invalid speaker profile size." }
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    cipher.updateAAD(accountId.toByteArray(Charsets.UTF_8))
    val bytes = cipher.iv + cipher.doFinal(plain)
    val dest = file(accountId)
    val output = dest.startWrite()
    try {
      output.write(bytes)
      dest.finishWrite(output)
    } catch (error: Exception) {
      dest.failWrite(output)
      throw error
    }
  }

  fun forget(accountId: String) = synchronized(mutex) {
    file(accountId).delete()
  }
}
