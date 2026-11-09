package com.personal.voiceapp.platform

/** A Bluetooth bond or a matching display name alone cannot prove an A2DP media connection. */
internal object BluetoothSpeakerOutputMatch {
  data class Endpoint(val id: Int, val name: String, val address: String)

  private fun normalized(address: String): String =
    address.trim().uppercase().replace("-", ":")

  fun choose(
    targetAddress: String, targetName: String,
    connectedProfileAddresses: List<String>, mediaOutputs: List<Endpoint>,
  ): Endpoint? {
    val target = normalized(targetAddress)
    val connected = connectedProfileAddresses.map(::normalized)
    if (target.isEmpty() || target !in connected) return null

    val direct = mediaOutputs.filter { normalized(it.address) == target }
    if (direct.size == 1) return direct.single()
    if (direct.size > 1) return null

    // Some Android audio routes redact a device address. Fall back only if
    // there is one connected A2DP profile and one output bearing the exact
    // user-visible device name. Never choose the first arbitrary speaker.
    if (connected.size != 1) return null
    val byName = mediaOutputs.filter {
      // An output with a concrete *different* Bluetooth address is not the target.
      normalized(it.address).isEmpty() &&
        it.name.trim().equals(targetName.trim(), ignoreCase = true)
    }
    return byName.singleOrNull()
  }
}
