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
  data class Typed(val appId: String?, val appLabel: String?) : InsertResult()
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

    /** Provisional updates are only allowed for an unchanged native EditText. */
    fun liveText(phase: String, text: String): Boolean = instance?.liveTextInFocusedField(phase, text) ?: false

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

  private data class Preview(
    val windowId: Int,
    val packageName: String,
    val viewId: String?,
    val before: String,
    val after: String,
    var provisional: String,
  )

  private var preview: Preview? = null

  private fun liveTextInFocusedField(phase: String, text: String): Boolean {
    if (phase == "cancel") {
      val active = preview ?: return false
      preview = null
      val node = focusedField() ?: return false
      if (!samePreviewField(node, active)) return false
      return replacePreview(node, active, "", active.before + active.provisional + active.after)
    }
    if (phase != "update" && phase != "commit") return false
    val node = focusedField() ?: return false
    if (node.isPassword || !isNativeTextField(node)) return false
    if (node.actionList.none { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT }) return false
    val active = preview ?: run {
      val current = node.text?.toString().orEmpty()
      val start = node.textSelectionStart
      val end = node.textSelectionEnd
      if (start < 0 || end < 0 || start > current.length || end > current.length) return false
      Preview(
        node.windowId,
        node.packageName?.toString().orEmpty(),
        node.viewIdResourceName,
        current.substring(0, minOf(start, end)),
        current.substring(maxOf(start, end)),
        "",
      ).also { preview = it }
    }
    if (!samePreviewField(node, active)) { preview = null; return false }
    val expected = active.before + active.provisional + active.after
    if (!replacePreview(node, active, text, expected)) { preview = null; return false }
    if (phase == "commit") preview = null else active.provisional = text
    return true
  }

  private fun samePreviewField(node: AccessibilityNodeInfo, state: Preview): Boolean =
    node.windowId == state.windowId &&
      node.packageName?.toString().orEmpty() == state.packageName &&
      node.viewIdResourceName == state.viewId &&
      !node.isPassword && isNativeTextField(node)

  private fun replacePreview(node: AccessibilityNodeInfo, state: Preview, replacement: String, expected: String): Boolean {
    if (node.text?.toString().orEmpty() != expected) return false
    val result = state.before + replacement + state.after
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, result) }
    if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
    val cursor = state.before.length + replacement.length
    val position = Bundle().apply {
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, cursor)
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, cursor)
    }
    node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, position)
    return true
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onUnbind(intent: Intent?): Boolean {
    preview = null
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    preview = null
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
    if (isNativeTextField(node) && setText(node, text)) return typedInto(node)
    setClip(this, text)
    if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) return typedInto(node)
    return InsertResult.Failed("This field doesn't accept dictated text. The text is on your clipboard.")
  }

  /** Package name plus launcher label. A window title is never used. */
  private fun typedInto(node: AccessibilityNodeInfo): InsertResult {
    val pkg = node.packageName?.toString()?.trim().orEmpty()
    if (pkg.isEmpty()) return InsertResult.Typed(null, null)
    if (pkg == packageName) return InsertResult.Typed("personal-voice", "Personal Voice")
    if (pkg.length > 120 || !pkg.matches(Regex("^[A-Za-z0-9._-]+$"))) return InsertResult.Typed(null, null)
    val label = applicationLabel(pkg) ?: pkg.substringAfterLast('.').ifBlank { pkg }
    return InsertResult.Typed(pkg, label.take(60))
  }

  private fun applicationLabel(packageName: String): String? {
    return try {
      val info = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(info)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
      null
    }
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
