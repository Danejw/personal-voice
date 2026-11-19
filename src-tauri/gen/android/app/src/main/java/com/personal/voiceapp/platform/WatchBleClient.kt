package com.personal.voiceapp.platform

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import org.json.JSONObject
import java.util.UUID

/**
 * V0 Personal Voice integration example. Host app owns runtime BLE permission
 * requests, device selection UI, lifecycle, and secure pairing policy.
 * BENCH ONLY: matching device firmware has no application authorization.
 */
@SuppressLint("MissingPermission")
class WatchBleClient(private val context: Context, private val listener: Listener) {
    interface Listener {
        fun onFound(device: BluetoothDevice)
        fun onConnected(deviceId: String, capabilities: List<String>)
        fun onEvent(event: String)
        fun onDisconnected()
        fun onError(description: String)
    }

    companion object {
        val SERVICE: UUID = UUID.fromString("8d39fbe0-3fa8-475f-9e08-f6ca3ff2de10")
        val MANIFEST: UUID = UUID.fromString("8d39fbe0-3fa8-475f-9e08-f6ca3ff2de11")
        val EVENT: UUID = UUID.fromString("8d39fbe0-3fa8-475f-9e08-f6ca3ff2de12")
        val COMMAND: UUID = UUID.fromString("8d39fbe0-3fa8-475f-9e08-f6ca3ff2de13")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val adapter = context.getSystemService(BluetoothManager::class.java).adapter
    private val scanner get() = adapter?.bluetoothLeScanner
    private var gatt: BluetoothGatt? = null
    private var eventCharacteristic: BluetoothGattCharacteristic? = null
    private var commandCharacteristic: BluetoothGattCharacteristic? = null
    private var sequence = 0
    private var ready = false
    private var pendingManifest: Pair<String, List<String>>? = null

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            listener.onFound(result.device)
        }
        override fun onScanFailed(errorCode: Int) {
            listener.onError("BLE scan failed: $errorCode")
        }
    }

    fun startScan() {
        val bleScanner = scanner ?: run {
            listener.onError("Bluetooth unavailable or disabled")
            return
        }
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()
        bleScanner.startScan(listOf(filter), ScanSettings.Builder().build(), scanCallback)
    }

    fun stopScan() { scanner?.stopScan(scanCallback) }

    fun connect(device: BluetoothDevice) {
        stopScan()
        gatt?.close()
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    fun ping() {
        if (!ready) { listener.onError("Watch notifications are not active"); return }
        val currentGatt = gatt ?: return
        val characteristic = commandCharacteristic ?: return
        if (Build.VERSION.SDK_INT >= 33) {
            currentGatt.writeCharacteristic(characteristic, byteArrayOf('?'.code.toByte()),
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            @Suppress("DEPRECATION")
            characteristic.value = byteArrayOf('?'.code.toByte())
            @Suppress("DEPRECATION")
            currentGatt.writeCharacteristic(characteristic)
        }
    }

    fun close() {
        stopScan()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        eventCharacteristic = null
        commandCharacteristic = null
        pendingManifest = null
        ready = false
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener.onError("GATT connection status: $status")
            }
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                if (!g.requestMtu(185)) g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                eventCharacteristic = null
                commandCharacteristic = null
                pendingManifest = null
                ready = false
                listener.onDisconnected()
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS || mtu < 64) {
                listener.onError("MTU too small for V0 manifest (got $mtu)")
                return
            }
            g.discoverServices()
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener.onError("Service discovery failed: $status")
                return
            }
            val service = g.getService(SERVICE) ?: run {
                listener.onError("UDP/1 watch service missing")
                return
            }
            eventCharacteristic = service.getCharacteristic(EVENT)
            commandCharacteristic = service.getCharacteristic(COMMAND)
            val manifest = service.getCharacteristic(MANIFEST)
            if (eventCharacteristic == null || commandCharacteristic == null || manifest == null) {
                listener.onError("Required watch characteristics missing")
                return
            }
            if (!g.readCharacteristic(manifest)) listener.onError("Manifest read could not start")
        }

        private fun manifestRead(g: BluetoothGatt, value: ByteArray, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener.onError("Manifest read failed: $status")
                return
            }
            try {
                val payload = JSONObject(value.toString(Charsets.UTF_8))

                val id = payload.getString("id")
                val caps = payload.getJSONArray("caps")
                val capabilities = (0 until caps.length()).map { caps.getString(it) }
                require(WatchWire.accepts(payload.getInt("v"), id, capabilities)) {
                    "Unsupported watch identity, version or capabilities"
                }
                val events = eventCharacteristic ?: error("Missing event characteristic")
                if (!g.setCharacteristicNotification(events, true)) {
                    error("Notification registration rejected")
                }
                val cccd = events.getDescriptor(CCCD) ?: error("CCCD missing")
                pendingManifest = id to capabilities
                if (Build.VERSION.SDK_INT >= 33) {
                    val rc = g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    if (rc != android.bluetooth.BluetoothStatusCodes.SUCCESS) {
                        listener.onError("Cannot write notification descriptor: $rc")
                    }
                } else {
                    @Suppress("DEPRECATION")
                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    @Suppress("DEPRECATION")
                    if (!g.writeDescriptor(cccd)) listener.onError("Cannot write notification descriptor")
                }
            } catch (exc: Exception) {
                listener.onError("Invalid V0 manifest: ${exc.message}")
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor,
                                       status: Int) {
            if (d.uuid != CCCD) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                listener.onError("Notification subscription failed: $status")
                return
            }
            ready = true
            pendingManifest?.let { (id, caps) -> listener.onConnected(id, caps) }
            pendingManifest = null
        }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic,
                                          value: ByteArray, status: Int) {
            if (c.uuid == MANIFEST) manifestRead(g, value, status)
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic,
                                          status: Int) {
            if (Build.VERSION.SDK_INT < 33 && c.uuid == MANIFEST) {
                manifestRead(g, c.value ?: byteArrayOf(), status)
            }
        }

        private fun handleEvent(value: ByteArray) {
            if (!ready) return
            val event = WatchWire.event(value) ?: return
            listener.onEvent(event)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic,
                                             value: ByteArray) {
            if (c.uuid == EVENT) handleEvent(value)
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33 && c.uuid == EVENT) {
                handleEvent(c.value ?: byteArrayOf())
            }
        }
    }
}
