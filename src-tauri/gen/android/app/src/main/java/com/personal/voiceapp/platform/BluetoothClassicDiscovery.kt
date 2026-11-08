package com.personal.voiceapp.platform

import android.Manifest
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** A short, explicitly requested Bluetooth Classic inquiry plus already bonded devices. */
internal object BluetoothClassicDiscovery {
  fun start(
    context: Context,
    onDevice: (address: String, name: String, kind: String, source: String, paired: Boolean, rssi: Int?) -> Unit,
  ): () -> Unit {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) return {}

    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      ?: return {}
    try {
      for (device in adapter.bondedDevices) {
        val address = device.address ?: continue
        val name = device.name ?: "Paired Bluetooth device"
        onDevice(address, name, classify(device), "bluetooth-paired", true, null)
      }
    } catch (_: SecurityException) {
      return {}
    }

    val receiver = object : BroadcastReceiver() {
      @Suppress("DEPRECATION")
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != BluetoothDevice.ACTION_FOUND) return
        val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        else intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        if (device == null) return
        try {
          val address = device.address ?: return
          val name = intent.getStringExtra(BluetoothDevice.EXTRA_NAME)
            ?: device.name ?: "Bluetooth device"
          val paired = device.bondState == BluetoothDevice.BOND_BONDED
          val rawSignal = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE)
          val signal = if (rawSignal == Short.MIN_VALUE) null else rawSignal.toInt()
          onDevice(address, name, classify(device),
            if (paired) "bluetooth-paired" else "bluetooth-classic", paired, signal)
        } catch (_: SecurityException) {
          // Permission can be revoked while an inquiry is running.
        }
      }
    }

    var registered = false
    var started = false
    try {
      val filter = IntentFilter(BluetoothDevice.ACTION_FOUND)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(receiver, filter)
      }
      registered = true
      started = adapter.startDiscovery()
    } catch (_: Exception) {
      // Bluetooth off / not supported. Still return previously paired devices.
    }
    return {
      if (started) try { adapter.cancelDiscovery() } catch (_: Exception) {}
      if (registered) try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
    }
  }

  private fun classify(device: BluetoothDevice): String = try {
    when (device.bluetoothClass?.majorDeviceClass) {
      BluetoothClass.Device.Major.COMPUTER -> "computer"
      BluetoothClass.Device.Major.PHONE -> "phone"
      BluetoothClass.Device.Major.AUDIO_VIDEO -> "speaker"
      BluetoothClass.Device.Major.IMAGING -> "printer"
      else -> "unknown"
    }
  } catch (_: SecurityException) { "unknown" }
}
