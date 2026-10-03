package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CameraFacingSelectTest {
  private val devices = listOf(
    CameraChoice("front", "Front camera", CameraFacingChoice.FRONT),
    CameraChoice("back", "Rear camera", CameraFacingChoice.BACK),
  )

  @Test
  fun parsesFacingAliases() {
    assertEquals(CameraFacingChoice.DEFAULT, CameraFacingSelect.parse(null))
    assertEquals(CameraFacingChoice.FRONT, CameraFacingSelect.parse("front"))
    assertEquals(CameraFacingChoice.BACK, CameraFacingSelect.parse("rear"))
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsUnknownFacing() {
    CameraFacingSelect.parse("side")
  }

  @Test
  fun picksFacingThenDefault() {
    assertEquals("back", CameraFacingSelect.pick(devices, CameraFacingChoice.BACK)?.id)
    assertEquals("front", CameraFacingSelect.pick(devices, CameraFacingChoice.DEFAULT)?.id)
    assertNull(CameraFacingSelect.pick(emptyList(), CameraFacingChoice.FRONT))
  }
}
