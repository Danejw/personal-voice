package com.personal.voiceapp.platform

/**
 * Pure facing selection for Android cameras. Keeps CameraX details out of unit tests.
 */
enum class CameraFacingChoice {
  DEFAULT,
  FRONT,
  BACK,
}

data class CameraChoice(
  val id: String,
  val label: String,
  val facing: CameraFacingChoice,
)

object CameraFacingSelect {
  fun parse(raw: String?): CameraFacingChoice = when (raw?.lowercase()) {
    null, "", "default" -> CameraFacingChoice.DEFAULT
    "front" -> CameraFacingChoice.FRONT
    "back", "rear" -> CameraFacingChoice.BACK
    else -> throw IllegalArgumentException("Camera must be default, front, or back.")
  }

  fun wireName(facing: CameraFacingChoice): String = when (facing) {
    CameraFacingChoice.DEFAULT -> "default"
    CameraFacingChoice.FRONT -> "front"
    CameraFacingChoice.BACK -> "back"
  }

  fun pick(devices: List<CameraChoice>, facing: CameraFacingChoice): CameraChoice? {
    if (devices.isEmpty()) return null
    if (facing == CameraFacingChoice.FRONT || facing == CameraFacingChoice.BACK) {
      devices.firstOrNull { it.facing == facing }?.let { return it }
    }
    return devices.first()
  }
}
