package com.personal.voiceapp.platform

/** Stateless watch V0 contract for native JVM tests. */
internal object WatchWire {
  fun accepts(version: Int, id: String, capabilities: List<String>) =
    version == 1 && id == "watch-v0" && capabilities == listOf("button.primary")

  fun event(bytes: ByteArray): String? {
    if (bytes.size != 1) return null
    return when (bytes[0].toInt().toChar()) {
      'P' -> "button.primary.pressed"
      '!' -> "device.pong"
      else -> null
    }
  }
}
