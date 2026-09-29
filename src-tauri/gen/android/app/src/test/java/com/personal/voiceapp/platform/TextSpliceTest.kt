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

class FieldSelectionTest {
  @Test
  fun readsTheHighlightedRange() {
    assertEquals(FieldSelection.Text("world"), selectionFromField("Hello world", 6, 11, false))
  }

  @Test
  fun readsASelectionMadeBackwards() {
    assertEquals(FieldSelection.Text("world"), selectionFromField("Hello world", 11, 6, false))
  }

  @Test
  fun refusesACollapsedCursor() {
    assertEquals(
      FieldSelection.None("No text is selected in the other app."),
      selectionFromField("Hello", 2, 2, false),
    )
  }

  @Test
  fun refusesHintText() {
    assertEquals(
      FieldSelection.None("No text is selected in the other app."),
      selectionFromField("Search", 0, 6, true),
    )
  }

  @Test
  fun refusesAnUnknownRange() {
    assertEquals(
      FieldSelection.None("No text is selected in the other app."),
      selectionFromField("Hello", -1, -1, false),
    )
  }
}
