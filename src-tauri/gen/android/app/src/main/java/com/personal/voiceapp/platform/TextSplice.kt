package com.personal.voiceapp.platform

/** The field's new text and where the cursor goes, after `insert` replaces the selection. */
data class Splice(val text: String, val cursor: Int)

sealed class FieldSelection {
  data class Text(val text: String) : FieldSelection()
  data class None(val message: String) : FieldSelection()
}

/**
 * Replaces the selection `[selectionStart, selectionEnd)` of `current` with `insert`.
 * An unknown or out-of-range selection (Android reports -1) appends at the end.
 */
fun spliceText(current: String, selectionStart: Int, selectionEnd: Int, insert: String): Splice {
  val valid = selectionStart in 0..current.length && selectionEnd in 0..current.length
  val start = if (valid) minOf(selectionStart, selectionEnd) else current.length
  val end = if (valid) maxOf(selectionStart, selectionEnd) else current.length
  return Splice(current.substring(0, start) + insert + current.substring(end), start + insert.length)
}

/**
 * The highlighted substring of a focused editable field. A collapsed cursor, hint text,
 * or an unknown range is not a selection.
 */
fun selectionFromField(
  current: String,
  selectionStart: Int,
  selectionEnd: Int,
  showingHint: Boolean,
): FieldSelection {
  if (showingHint) {
    return FieldSelection.None("No text is selected in the other app.")
  }
  val valid = selectionStart in 0..current.length && selectionEnd in 0..current.length
  if (!valid) {
    return FieldSelection.None("No text is selected in the other app.")
  }
  val start = minOf(selectionStart, selectionEnd)
  val end = maxOf(selectionStart, selectionEnd)
  if (start == end) {
    return FieldSelection.None("No text is selected in the other app.")
  }
  return FieldSelection.Text(current.substring(start, end))
}
