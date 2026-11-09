package com.personal.voiceapp.platform

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * One user-initiated Connect & Use attempt. No hidden A2DP connect API, unbounded polling,
 * arbitrary MAC addresses, cloud inventory, or silent fallback to another speaker.
 * All mutations run on the main looper; native status reads are volatile snapshots.
 */
internal class BluetoothSpeakerHandoff(
  context: Context,
  private val selectAssistantOutput: (Int) -> Boolean,
) {
  private val app = context.applicationContext
  private val handler = Handler(Looper.getMainLooper())
  private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val adapter = (app.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  data class Status(
    val state: String = "idle",
    val deviceId: String? = null,
    val name: String? = null,
    val message: String = "Select a scanned Bluetooth speaker to connect and use.",
    val selectedOutputId: String? = null,
    val routeObserved: Boolean = false,
    val needsAndroidInteraction: Boolean = false,
  )

  @Volatile private var status = Status()
  private var target: NearbyDeviceDiscovery.BluetoothTarget? = null
  private var profile: BluetoothProfile? = null
  private var profileRequested = false
  private var generation = 0
  private var startedAt = 0L
  private var bondAttempted = false
  private var settingsOpened = false
  private var bondedSince = 0L
  private var active = false

  private val listener = object : BluetoothProfile.ServiceListener {
    override fun onServiceConnected(type: Int, proxy: BluetoothProfile) {
      if (type == BluetoothProfile.A2DP) {
        profile = proxy
        handler.post { if (active) check() }
      }
    }
    override fun onServiceDisconnected(type: Int) {
      if (type == BluetoothProfile.A2DP) profile = null
    }
  }

  fun snapshot(): Status = status

  fun begin(id: String): Status {
    endObservation()
    val selected = NearbyDeviceDiscovery.bluetoothTarget(id)
      ?: throw IllegalArgumentException("This Bluetooth device is not in a recent scan. Scan Nearby again.")
    require(selected.kind == "speaker") {
      "Connect & Use requires a device identified as Bluetooth audio. Other devices use Android Settings."
    }
    require(allowed()) { "Allow Android Nearby Devices permission, then scan again." }
    require(adapter != null) { "This phone does not expose a Bluetooth adapter." }

    target = selected
    generation += 1
    startedAt = SystemClock.elapsedRealtime()
    bondedSince = 0L
    bondAttempted = false
    settingsOpened = false
    active = true
    status = Status("checking", selected.id, selected.name,
      "Checking Android pairing and A2DP media connection.")
    val ticket = generation
    check()
    // A bounded attempt, not a permanent radio monitor or background reconnection service.
    handler.postDelayed({
      if (active && generation == ticket) terminal("timed_out",
        "No verified media connection within two minutes. Try Connect & Use again.")
    }, MAX_WAIT_MS)
    return status
  }

  fun cancel(): Status {
    if (active) terminal("cancelled", "Connect & Use cancelled; existing Android pairing is unchanged.")
    return status
  }

  private fun allowed(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      ContextCompat.checkSelfPermission(app, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED

  private fun check() {
    if (!active) return
    val item = target ?: return
    val bt = adapter ?: return
    if (!allowed()) {
      terminal("permission_required", "Android Nearby Devices permission was revoked.")
      return
    }
    if (!bt.isEnabled) {
      status = status.copy(state = "bluetooth_off", needsAndroidInteraction = true,
        message = "Turn on Bluetooth in Android Settings, then connect " + item.name + ".")
      openSettingsOnce()
      schedule()
      return
    }

    if (!profileRequested) {
      profileRequested = true
      try {
        if (!bt.getProfileProxy(app, listener, BluetoothProfile.A2DP)) profileRequested = false
      } catch (_: Exception) { profileRequested = false }
    }

    val device = try { bt.getRemoteDevice(item.address) } catch (_: Exception) {
      terminal("failed", "Android could not resolve this scanned Bluetooth identity.")
      return
    }
    val bonded = try { device.bondState } catch (_: SecurityException) {
      terminal("permission_required", "Allow Android Nearby Devices permission.")
      return
    }
    if (bonded != BluetoothDevice.BOND_BONDED) {
      bondedSince = 0L
      if (!bondAttempted && item.observedNow && item.kind == "speaker") {
        bondAttempted = true
        val started = try { device.createBond() } catch (_: Exception) { false }
        status = status.copy(state = if (started) "pairing" else "connect_in_android",
          needsAndroidInteraction = true,
          message = if (started) "Approve the Android pairing prompt for " + item.name + "."
            else "Pair " + item.name + " in Android Bluetooth settings.")
        if (!started) openSettingsOnce()
      } else {
        status = status.copy(state = "pairing", needsAndroidInteraction = true,
          message = "Finish Android pairing for " + item.name +
            ". If pairing was cancelled, restart Connect & Use.")
      }
      schedule()
      return
    }

    if (bondedSince == 0L) bondedSince = SystemClock.elapsedRealtime()
    val a2dpAddresses = try { profile?.connectedDevices?.map { it.address } ?: emptyList() }
      catch (_: SecurityException) { emptyList() }
    val outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      .filter { it.isSink && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
      .map { BluetoothSpeakerOutputMatch.Endpoint(it.id, it.productName?.toString() ?: "",
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.address else "") }
    val match = BluetoothSpeakerOutputMatch.choose(item.address, item.name, a2dpAddresses, outputs)
    if (match != null) {
      try {
        val observedRoute = selectAssistantOutput(match.id)
        status = status.copy(state = if (observedRoute) "routed" else "selected",
          selectedOutputId = "audio:" + match.id, routeObserved = observedRoute,
          needsAndroidInteraction = false,
          message = if (observedRoute)
            "Android reports Assistant speech routed to " + item.name + ". Listen to confirm playback."
            else item.name + " is connected and selected for Assistant speech. Listen to the next reply.")
        endObservation(keepStatus = true)
        return
      } catch (error: Exception) {
        terminal("failed", "Android audio output selection failed: " +
          (error.message ?: "unknown error"))
        return
      }
    }

    status = status.copy(state = "connect_in_android", needsAndroidInteraction = true,
      message = if (a2dpAddresses.any { it.equals(item.address, ignoreCase = true) })
        "A2DP connected, but Android has not exposed an unambiguous media output for " +
          item.name + ". Check Media audio in Bluetooth Settings."
      else "In Android Bluetooth Settings, connect " + item.name +
        " and enable Media audio. Personal Voice will route its speech when that device is verified.")
    // Pairing may auto-connect; allow a short grace period before interrupting with Settings.
    if (!settingsOpened && SystemClock.elapsedRealtime() - bondedSince > 1_500L) openSettingsOnce()
    schedule()
  }

  private fun schedule() {
    val ticket = generation
    handler.postDelayed({
      if (generation == ticket && active && SystemClock.elapsedRealtime() - startedAt < MAX_WAIT_MS) check()
    }, POLL_MS)
  }

  private fun openSettingsOnce() {
    if (settingsOpened) return
    settingsOpened = true
    try {
      app.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      status = status.copy(message = "Open Android Bluetooth Settings manually and connect the selected speaker.")
    }
  }

  private fun terminal(state: String, message: String) {
    status = status.copy(state = state, message = message, needsAndroidInteraction = false)
    endObservation(keepStatus = true)
  }

  private fun endObservation(keepStatus: Boolean = false) {
    active = false
    generation += 1
    val oldProfile = profile
    profile = null
    if (oldProfile != null) try {
      adapter?.closeProfileProxy(BluetoothProfile.A2DP, oldProfile)
    } catch (_: Exception) {}
    profileRequested = false
    target = null
    if (!keepStatus) status = Status()
  }

  companion object {
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_MS = 1_000L
  }
}
