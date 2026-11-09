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

    // Some Android versions redact or replace AudioDeviceInfo.address with a
    // non-MAC route string. When the exact target is the ONLY A2DP profile
    // connection, exactly one connected A2DP output with no concrete, conflicting
    // MAC is safe to select. Do not rely on a coincidentally matching name.
    if (connected.size != 1) return null
    val bluetoothMac = Regex("^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$")
    val unaddressed = mediaOutputs.filter { !bluetoothMac.matches(normalized(it.address)) }
    return unaddressed.singleOrNull()
  }
}
