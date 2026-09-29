package com.personal.voiceapp.platform

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

sealed class InsertResult {
  object Typed : InsertResult()
  data class Failed(val message: String) : InsertResult()
}

sealed class CaptureResult {
  data class Captured(val text: String, val sourceApp: String?) : CaptureResult()
  data class Failed(val message: String) : CaptureResult()
}

/**
 * Types dictated text into the input-focused field of another app, and can read
 * a selection in that same field on demand.
 *
 * Scope is deliberately narrow: the service subscribes to no accessibility events, so it
 * never observes the screen. It reads only the focused node, only when `insert` or
 * `capture` is called, and never touches password fields.
 */
class VoiceAccessibilityService : AccessibilityService() {
  companion object {
    private const val MAX_SEARCHED_NODES = 2_000

    @Volatile private var instance: VoiceAccessibilityService? = null

    val isConnected: Boolean get() = instance != null

    /** Main thread only. Falls back to the clipboard whenever typing directly isn't possible. */
    fun insert(context: Context, text: String): InsertResult {
      val service = instance
        ?: return copyToClipboard(
          context, text,
          "Turn on the Personal Voice accessibility service to type into other apps. The text is on your clipboard.",
        )
      return service.insertIntoFocusedField(text)
    }

    /** Main thread only. Reads the highlighted range of the focused editable field. */
    fun capture(): CaptureResult {
      val service = instance
        ?: return CaptureResult.Failed(
          "Turn on the Personal Voice accessibility service to read a selected field.",
        )
      return service.captureFromFocusedField()
    }

    private fun copyToClipboard(context: Context, text: String, message: String): InsertResult {
      setClip(context, text)
      return InsertResult.Failed(message)
    }

    private fun setClip(context: Context, text: String) {
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("Dictation", text))
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  private fun insertIntoFocusedField(text: String): InsertResult {
    val node = focusedField()
    if (node == null) {
      return copyToClipboard(this, text, "No text field is selected. The text is on your clipboard.")
    }
    if (node.isPassword) return InsertResult.Failed("Dictation doesn't type into password fields.")
    // Native fields take an exact splice. Web and rich editors get a paste, because replacing
    // their whole text would drop formatting.
    if (isNativeTextField(node) && setText(node, text)) return InsertResult.Typed
    setClip(this, text)
    if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) return InsertResult.Typed
    return InsertResult.Failed("This field doesn't accept dictated text. The text is on your clipboard.")
  }

  private fun captureFromFocusedField(): CaptureResult {
    val node = focusedField()
      ?: return CaptureResult.Failed("No text field is selected.")
    if (node.isPassword) return CaptureResult.Failed("Selection capture doesn't read password fields.")
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText
    return when (
      val extracted = selectionFromField(
        node.text?.toString().orEmpty(),
        node.textSelectionStart,
        node.textSelectionEnd,
        showingHint,
      )
    ) {
      is FieldSelection.Text -> CaptureResult.Captured(extracted.text, node.packageName?.toString())
      is FieldSelection.None -> CaptureResult.Failed(extracted.message)
    }
  }

  /**
   * The editable node with input focus. Chrome reports its web content view as the input focus,
   * with the actual field as a focused virtual child, so a non-editable focus is searched beneath.
   */
  private fun focusedField(): AccessibilityNodeInfo? {
    val focus = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
    if (focus.isEditable) return focus
    return findFocusedEditable(focus) ?: rootInActiveWindow?.let(::findFocusedEditable)
  }

  /** Breadth-first and bounded; only focus and editability are read on the way. */
  private fun findFocusedEditable(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
    val queue = ArrayDeque<AccessibilityNodeInfo>().apply { add(root) }
    var visited = 0
    while (queue.isNotEmpty() && visited++ < MAX_SEARCHED_NODES) {
      val node = queue.removeFirst()
      if (node.isFocused && node.isEditable) return node
      for (index in 0 until node.childCount) node.getChild(index)?.let(queue::addLast)
    }
    return null
  }

  private fun isNativeTextField(node: AccessibilityNodeInfo): Boolean {
    val isWebContent = node.extras.containsKey("AccessibilityNodeInfo.chromeRole")
    return !isWebContent && node.className?.toString()?.endsWith("EditText") == true
  }

  private fun setText(node: AccessibilityNodeInfo, text: String): Boolean {
    if (node.actionList.none { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT }) return false
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText
    val current = if (showingHint) "" else node.text?.toString().orEmpty()
    val splice = spliceText(current, node.textSelectionStart, node.textSelectionEnd, text)
    val setArgs = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, splice.text)
    }
    if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, setArgs)) return false
    val cursorArgs = Bundle().apply {
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, splice.cursor)
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, splice.cursor)
    }
    node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, cursorArgs)
    return true
  }
}
