package com.personal.voiceapp.platform

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/** A device listed here is a connected output, not a Bluetooth pairing or scanner result. */
internal class AssistantAudioOutputs(context: Context) {
  private val audio = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var chosenId: Int? = null

  data class Output(val id: String, val name: String, val type: String, val selected: Boolean)

  private fun mediaType(type: Int): Boolean = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> true
    else -> {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (type == AudioDeviceInfo.TYPE_BLE_SPEAKER || type == AudioDeviceInfo.TYPE_BLE_HEADSET)
    }
  }

  private fun kind(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth media (A2DP)"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth call audio"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "Wired"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB"
    else -> "Bluetooth LE audio"
  }

  private fun current(): List<AudioDeviceInfo> = try {
    audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      .filter { it.isSink && mediaType(it.type) }
  } catch (_: Exception) { emptyList() }

  fun list(): List<Output> {
    val active = selectedDevice()
    return listOf(Output("system", "System default", "Automatic call/communication route", chosenId == null)) +
      current().map { device ->
        Output("audio:" + device.id, device.productName?.toString()?.take(80)?.takeIf { it.isNotBlank() }
          ?: kind(device.type), kind(device.type), active?.id == device.id)
      }
  }

  /** Prefer a currently connected output; an old bond or guessed MAC is never eligible. */
  fun choose(id: String) {
    if (id == "system") {
      chosenId = null
      return
    }
    val numericId = id.removePrefix("audio:").takeIf { id.startsWith("audio:") }
      ?.toIntOrNull() ?: throw IllegalArgumentException("Select a connected audio output.")
    require(current().any { it.id == numericId }) {
      "That audio output is not connected. Connect it in Android Bluetooth settings first."
    }
    chosenId = numericId
  }

  fun selectedDevice(): AudioDeviceInfo? =
    chosenId?.let { id -> current().firstOrNull { it.id == id } }

  fun requiresMediaPlayback(): Boolean = chosenId != null

  fun selectedAvailable(): Boolean = chosenId == null || selectedDevice() != null
}
