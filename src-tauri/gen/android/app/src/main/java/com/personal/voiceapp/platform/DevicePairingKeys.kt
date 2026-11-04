package com.personal.voiceapp.platform

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID

/** Non-exportable signing identities owned by the Android Keystore, one per account-device UUID. */
internal object DevicePairingKeys {
  private fun alias(deviceId: String): String =
    "personal-voice-pair-v1-${UUID.fromString(deviceId)}"

  private fun store(): KeyStore =
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  @Synchronized
  private fun entry(deviceId: String): KeyStore.PrivateKeyEntry {
    val keyAlias = alias(deviceId)
    var existing = store().getEntry(keyAlias, null) as? KeyStore.PrivateKeyEntry
    if (existing == null) {
      val pair = KeyPairGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore"
      ).apply {
        initialize(
          KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build()
        )
      }.generateKeyPair()
      if (pair.private.encoded != null) {
        throw IllegalStateException("Pairing key must not be exportable.")
      }
      existing = store().getEntry(keyAlias, null) as? KeyStore.PrivateKeyEntry
    }
    return existing ?: throw IllegalStateException("Unable to open Android pairing identity.")
  }

  private fun fixed32(bytes: ByteArray): ByteArray {
    var pos = 0
    while (pos < bytes.size - 1 && bytes[pos] == 0.toByte()) pos++
    val count = bytes.size - pos
    require(count in 1..32) { "Invalid P-256 coordinate." }
    return ByteArray(32).also { out -> bytes.copyInto(out, 32 - count, pos) }
  }

  private fun base64(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

  fun publicKey(deviceId: String): Pair<String, String> {
    val key = entry(deviceId).certificate.publicKey as ECPublicKey
    return Pair(base64(fixed32(key.w.affineX.toByteArray())),
      base64(fixed32(key.w.affineY.toByteArray())))
  }

  // AndroidKeyStore ECDSA signatures are ASN.1 DER. Web Crypto and Windows CNG
  // both use the IEEE P1363 signature, r || s, exactly 64 bytes for P-256.
  internal fun derToP1363(der: ByteArray): ByteArray {
    require(der.size in 8..80 && der[0] == 0x30.toByte())
    val total = der[1].toInt() and 255
    require(total == der.size - 2 && total < 128) { "Invalid DER signature length." }
    var pos = 2
    val out = ByteArray(64)
    for (offset in listOf(0, 32)) {
      require(pos + 2 <= der.size && der[pos] == 0x02.toByte())
      val size = der[pos + 1].toInt() and 255
      pos += 2
      require(size in 1..33 && pos + size <= der.size)
      val raw = fixed32(der.copyOfRange(pos, pos + size))
      raw.copyInto(out, offset)
      pos += size
    }
    require(pos == der.size) { "Trailing DER signature data." }
    return out
  }

  fun sign(deviceId: String, message: String): String {
    require(message.length <= 2048) { "Pairing message is too large." }
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(entry(deviceId).privateKey)
    signer.update(message.toByteArray(Charsets.UTF_8))
    return base64(derToP1363(signer.sign()))
  }
}
