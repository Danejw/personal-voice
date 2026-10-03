package com.personal.voiceapp.platform

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import android.util.Size
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * CameraX photo + 1 FPS frame sampling with a visible preview pill.
 * Frames are JPEG base64 only; nothing is written to disk.
 */
class AndroidCameraSession(
  private val activity: android.app.Activity,
  private val lifecycleOwner: LifecycleOwner,
  private val onFrame: (jpegBase64: String, width: Int, height: Int, facing: String, label: String?) -> Unit,
  private val onError: (String) -> Unit,
) {
  private val mainExecutor = ContextCompat.getMainExecutor(activity)
  private var analysisExecutor: ExecutorService? = null
  private var provider: ProcessCameraProvider? = null
  private var imageCapture: ImageCapture? = null
  private var previewHost: FrameLayout? = null
  private var activeFacing: CameraFacingChoice = CameraFacingChoice.DEFAULT
  private var activeLabel: String? = null
  private val streaming = AtomicBoolean(false)
  private val lastFrameAt = AtomicLong(0L)
  private val encoding = AtomicBoolean(false)

  val isActive: Boolean get() = streaming.get()
  val facingWire: String get() = CameraFacingSelect.wireName(activeFacing)

  fun listDevices(): List<CameraChoice> {
    val provider = ProcessCameraProvider.getInstance(activity).get()
    val out = mutableListOf<CameraChoice>()
    if (provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) {
      out += CameraChoice("back", "Rear camera", CameraFacingChoice.BACK)
    }
    if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
      out += CameraChoice("front", "Front camera", CameraFacingChoice.FRONT)
    }
    return out
  }

  fun capturePhoto(facing: CameraFacingChoice, done: (Result<PhotoResult>) -> Unit) {
    ensurePermission()
    bringPreview(facing)
    bind(facing, frames = false) {
      val capture = imageCapture
      if (capture == null) {
        done(Result.failure(IllegalStateException("The camera could not be opened.")))
        releaseQuiet()
        return@bind
      }
      capture.takePicture(
        mainExecutor,
        object : ImageCapture.OnImageCapturedCallback() {
          override fun onCaptureSuccess(image: ImageProxy) {
            try {
              val jpeg = imageProxyToJpeg(image, maxEdge = 1280, quality = 92)
              val result = PhotoResult(
                jpegBase64 = Base64.encodeToString(jpeg.bytes, Base64.NO_WRAP),
                width = jpeg.width,
                height = jpeg.height,
                facing = CameraFacingSelect.wireName(facing),
                label = activeLabel,
              )
              done(Result.success(result))
            } catch (error: Exception) {
              done(Result.failure(error))
            } finally {
              image.close()
              releaseQuiet()
            }
          }

          override fun onError(exception: ImageCaptureException) {
            done(Result.failure(Exception("Could not capture a camera photo.", exception)))
            releaseQuiet()
          }
        },
      )
    }
  }

  fun startFrames(facing: CameraFacingChoice) {
    ensurePermission()
    if (streaming.get()) stop()
    streaming.set(true)
    lastFrameAt.set(0L)
    bringPreview(facing)
    bind(facing, frames = true) {}
  }

  fun switchFacing(facing: CameraFacingChoice) {
    if (!streaming.get()) throw IllegalStateException("Camera Context is not active.")
    startFrames(facing)
  }

  fun stop() {
    streaming.set(false)
    encoding.set(false)
    lastFrameAt.set(0L)
    releaseQuiet()
  }

  private fun ensurePermission() {
    val granted = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.CAMERA) ==
      android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!granted) throw SecurityException(CAMERA_DENIED)
  }

  private fun bringPreview(facing: CameraFacingChoice) {
    activeFacing = facing
    val devices = listDevices()
    val chosen = CameraFacingSelect.pick(devices, facing)
      ?: throw IllegalStateException("No camera was found.")
    activeLabel = chosen.label
    activeFacing = when (facing) {
      CameraFacingChoice.DEFAULT -> chosen.facing
      else -> facing
    }
  }

  private fun bind(facing: CameraFacingChoice, frames: Boolean, onBound: () -> Unit) {
    val future = ProcessCameraProvider.getInstance(activity)
    future.addListener({
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        cameraProvider.unbindAll()
        showPreviewChrome()
        val previewView = previewHost?.getChildAt(0) as? PreviewView
          ?: throw IllegalStateException("The camera preview could not be shown.")
        val selector = selectorFor(facing)
        val preview = Preview.Builder().build().also {
          it.surfaceProvider = previewView.surfaceProvider
        }
        imageCapture = ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .build()
        val useCases = mutableListOf(preview, imageCapture!!)
        if (frames) {
          val analysis = ImageAnalysis.Builder()
            .setTargetResolution(Size(1280, 720))
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
          val executor = Executors.newSingleThreadExecutor().also { analysisExecutor = it }
          analysis.setAnalyzer(executor) { image -> analyzeFrame(image) }
          useCases += analysis
        }
        cameraProvider.bindToLifecycle(lifecycleOwner, selector, *useCases.toTypedArray())
        onBound()
      } catch (error: Exception) {
        streaming.set(false)
        onError(error.message ?: "Could not open the camera.")
        releaseQuiet()
      }
    }, mainExecutor)
  }

  private fun analyzeFrame(image: ImageProxy) {
    if (!streaming.get()) {
      image.close()
      return
    }
    val now = System.currentTimeMillis()
    val last = lastFrameAt.get()
    if (last > 0 && now - last < 1_000L) {
      image.close()
      return
    }
    if (!encoding.compareAndSet(false, true)) {
      image.close()
      return
    }
    try {
      val jpeg = imageProxyToJpeg(image, maxEdge = 1280, quality = 80)
      lastFrameAt.set(now)
      val facing = CameraFacingSelect.wireName(activeFacing)
      val label = activeLabel
      mainExecutor.execute {
        if (streaming.get()) {
          onFrame(
            Base64.encodeToString(jpeg.bytes, Base64.NO_WRAP),
            jpeg.width,
            jpeg.height,
            facing,
            label,
          )
        }
        encoding.set(false)
      }
    } catch (_: Exception) {
      encoding.set(false)
    } finally {
      image.close()
    }
  }

  private fun selectorFor(facing: CameraFacingChoice): CameraSelector {
    val devices = listDevices()
    val chosen = CameraFacingSelect.pick(devices, facing)
      ?: throw IllegalStateException("No camera was found.")
    return when (chosen.facing) {
      CameraFacingChoice.FRONT -> CameraSelector.DEFAULT_FRONT_CAMERA
      CameraFacingChoice.BACK, CameraFacingChoice.DEFAULT -> CameraSelector.DEFAULT_BACK_CAMERA
    }
  }

  private fun showPreviewChrome() {
    if (previewHost != null) return
    val root = activity.window?.decorView as? ViewGroup ?: return
    val host = FrameLayout(activity).apply {
      layoutParams = FrameLayout.LayoutParams(
        dp(120),
        dp(160),
        Gravity.TOP or Gravity.END,
      ).also {
        it.topMargin = dp(48)
        it.marginEnd = dp(16)
      }
      setBackgroundColor(0xCC111820.toInt())
      elevation = dp(8).toFloat()
    }
    val preview = PreviewView(activity).apply {
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
      scaleType = PreviewView.ScaleType.FILL_CENTER
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }
    val label = TextView(activity).apply {
      text = "Camera On"
      setTextColor(0xFFE8EEF4.toInt())
      textSize = 12f
      setPadding(dp(8), dp(6), dp(8), dp(6))
      setBackgroundColor(0x99000000.toInt())
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM,
      )
    }
    host.addView(preview)
    host.addView(label)
    root.addView(host)
    previewHost = host
  }

  private fun releaseQuiet() {
    try {
      provider?.unbindAll()
    } catch (_: Exception) {
    }
    provider = null
    imageCapture = null
    analysisExecutor?.shutdownNow()
    analysisExecutor = null
    val host = previewHost
    previewHost = null
    if (host != null) {
      (host.parent as? ViewGroup)?.removeView(host)
    }
  }

  private fun dp(value: Int): Int =
    (value * activity.resources.displayMetrics.density).toInt()

  data class PhotoResult(
    val jpegBase64: String,
    val width: Int,
    val height: Int,
    val facing: String,
    val label: String?,
  )

  private data class EncodedJpeg(val bytes: ByteArray, val width: Int, val height: Int)

  companion object {
    const val CAMERA_DENIED = "Camera permission was denied. Allow camera access and try again."

    fun imageProxyToJpeg(image: ImageProxy, maxEdge: Int, quality: Int): EncodedJpeg {
      val bitmap = when (image.format) {
        ImageFormat.JPEG -> {
          val buffer = image.planes[0].buffer
          val bytes = ByteArray(buffer.remaining())
          buffer.get(bytes)
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalStateException("The camera image could not be read.")
        }
        else -> yuv420ToBitmap(image)
      }
      val rotated = rotateBitmap(bitmap, image.imageInfo.rotationDegrees)
      if (rotated !== bitmap) bitmap.recycle()
      val fitted = fitBitmap(rotated, maxEdge)
      if (fitted !== rotated) rotated.recycle()
      val stream = ByteArrayOutputStream()
      if (!fitted.compress(Bitmap.CompressFormat.JPEG, quality, stream)) {
        fitted.recycle()
        throw IllegalStateException("The camera image could not be read.")
      }
      val bytes = stream.toByteArray()
      val width = fitted.width
      val height = fitted.height
      fitted.recycle()
      return EncodedJpeg(bytes, width, height)
    }

    private fun yuv420ToBitmap(image: ImageProxy): Bitmap {
      val yBuffer = image.planes[0].buffer
      val uBuffer = image.planes[1].buffer
      val vBuffer = image.planes[2].buffer
      val ySize = yBuffer.remaining()
      val uSize = uBuffer.remaining()
      val vSize = vBuffer.remaining()
      val nv21 = ByteArray(ySize + uSize + vSize)
      yBuffer.get(nv21, 0, ySize)
      vBuffer.get(nv21, ySize, vSize)
      uBuffer.get(nv21, ySize + vSize, uSize)
      val yuv = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
      val out = ByteArrayOutputStream()
      yuv.compressToJpeg(Rect(0, 0, image.width, image.height), 92, out)
      val jpeg = out.toByteArray()
      return BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
        ?: throw IllegalStateException("The camera image could not be read.")
    }

    private fun rotateBitmap(source: Bitmap, degrees: Int): Bitmap {
      if (degrees == 0) return source
      val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
      return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    }

    private fun fitBitmap(source: Bitmap, maxEdge: Int): Bitmap {
      val long = maxOf(source.width, source.height)
      if (long <= maxEdge) return source
      val scale = maxEdge.toFloat() / long.toFloat()
      val width = maxOf(1, (source.width * scale).toInt())
      val height = maxOf(1, (source.height * scale).toInt())
      return Bitmap.createScaledBitmap(source, width, height, true)
    }
  }
}
