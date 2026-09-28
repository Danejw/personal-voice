package com.personal.voiceapp.platform

import org.junit.Assert.assertEquals
import org.junit.Test

class TextSpliceTest {
  @Test
  fun insertsAtTheCursor() {
    assertEquals(Splice("Hello big world", 10), spliceText("Hello world", 6, 6, "big "))
  }

  @Test
  fun replacesTheSelectionWhicheverWayItWasMade() {
    assertEquals(Splice("Hello there", 11), spliceText("Hello world", 11, 6, "there"))
  }

  @Test
  fun appendsWhenTheSelectionIsUnknown() {
    assertEquals(Splice("Note: done", 10), spliceText("Note: ", -1, -1, "done"))
  }

  @Test
  fun appendsWhenTheSelectionIsOutOfRange() {
    assertEquals(Splice("abcX", 4), spliceText("abc", 2, 9, "X"))
  }

  @Test
  fun fillsAnEmptyField() {
    assertEquals(Splice("Persyn", 6), spliceText("", 0, 0, "Persyn"))
  }
}
