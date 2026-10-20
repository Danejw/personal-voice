import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  slashToken,
  snippetReference,
  snippetSuggestions,
  type Snippet,
} from "@/snippets/snippet";
import {
  applyInlineSnippetReferences,
  draftHasContent,
  draftPlainText,
  editDraft,
  expandSnippetDraft,
  parseSnippetDraft,
  serializeSnippetDraft,
  spliceDraft,
  type SnippetDraftPart,
} from "@/snippets/snippetDraft";
import { placeCaret, readEditor, selectionOffset, selectionRange, writeEditor } from "@/snippets/snippetEditor";
import { registerSnippetInput } from "@/snippets/snippetInput";

const DRAFT_KEY = "pv.assistant.composer";

function loadDraft(): SnippetDraftPart[] {
  try {
    return parseSnippetDraft(sessionStorage.getItem(DRAFT_KEY) ?? "");
  } catch {
    return [];
  }
}

export interface SnippetComposerHandle {
  send: () => void;
}

/**
 * Assistant message field. Snippet references are chips keyed by snippet id.
 * Typing `/` inserts the same chip voice dictation inserts.
 */
interface SnippetComposerProps {
  snippets: readonly Snippet[];
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onContentChange?: (hasContent: boolean) => void;
}

export const SnippetComposer = forwardRef<SnippetComposerHandle, SnippetComposerProps>(function SnippetComposer({
  snippets,
  disabled,
  placeholder,
  onSend,
  onContentChange,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fromDom = useRef(false);
  const partsRef = useRef<SnippetDraftPart[]>([]);
  const snippetsRef = useRef(snippets);
  const [parts, setParts] = useState<SnippetDraftPart[]>(loadDraft);
  const [caret, setCaret] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  partsRef.current = parts;
  snippetsRef.current = snippets;

  const plain = draftPlainText(parts, snippets);
  const token = slashToken(plain, caret);
  const suggestions = token ? snippetSuggestions(token.query, snippets) : [];
  const suggestionIndex = suggestions.length ? Math.min(slashIndex, suggestions.length - 1) : 0;
  const preview = previewId ? parts.find((part) => part.kind === "snippet" && part.id === previewId) : null;
  const previewSnippet = preview && preview.kind === "snippet" ? snippets.find((snippet) => snippet.id === preview.id) : null;

  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const caretRef = useRef(caret);
  caretRef.current = caret;

  useEffect(() => { onContentChangeRef.current?.(draftHasContent(parts)); }, [parts]);
  useEffect(() => { setSlashIndex(0); }, [token?.query]);
  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, serializeSnippetDraft(parts)); } catch { /* The draft still lives in memory. */ }
  }, [parts]);

  useEffect(() => {
    return registerSnippetInput((transcript) => {
      const root = editorRef.current;
      if (!root || document.activeElement !== root || disabled) return false;
      const inline = applyInlineSnippetReferences(transcript, snippetsRef.current);
      const next = spliceDraft(partsRef.current, selectionOffset(root), selectionOffset(root), inline, snippetsRef.current);
      fromDom.current = false;
      setPreviewId(null);
      setProblem(null);
      setParts(next.parts);
      setCaret(next.caret);
      return true;
    });
  }, [disabled]);

  const snippetSignature = snippets.map((snippet) => `${snippet.id}:${snippet.slug}:${snippet.enabled}`).join("|");
  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    if (fromDom.current) {
      fromDom.current = false;
      return;
    }
    writeEditor(root, partsRef.current, snippetsRef.current);
    if (document.activeElement === root) placeCaret(root, caretRef.current);
  }, [parts, snippetSignature]);

  useImperativeHandle(ref, () => ({ send }), [parts, snippets, disabled]);

  function syncFromDom() {
    const root = editorRef.current;
    if (!root) return;
    fromDom.current = true;
    setParts(readEditor(root));
    setCaret(selectionOffset(root));
    setPreviewId(null);
    setProblem(null);
  }

  function insertSnippet(snippet: Snippet) {
    if (!token) return;
    const next = spliceDraft(
      parts,
      token.start,
      caret,
      [{ kind: "snippet", id: snippet.id, label: snippet.slug }],
      snippets,
    );
    fromDom.current = false;
    setParts(next.parts);
    setCaret(next.caret);
    setPreviewId(null);
    setProblem(null);
    editorRef.current?.focus();
  }

  function send() {
    const expanded = expandSnippetDraft(parts, snippets);
    if (!expanded.ok) {
      setProblem(expanded.message);
      return;
    }
    const text = expanded.text.trim();
    if (!text || disabled) return;
    onSend(text);
    fromDom.current = false;
    setParts([]);
    setCaret(0);
    setPreviewId(null);
    setProblem(null);
  }

  return (
    <div className="assistant-composer-field">
      <span className="visually-hidden">Message</span>
      {token && suggestions.length > 0 && (
        <ul className="snippet-suggest hide-scrollbar" role="listbox" aria-label="Snippets">
          {suggestions.map((snippet, index) => (
            <li key={snippet.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === suggestionIndex}
                className={index === suggestionIndex ? "is-active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertSnippet(snippet)}
              >
                <span>{snippetReference(snippet)}</span>
                <small>{snippet.trigger}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && preview.kind === "snippet" && (
        <div className="snippet-preview" role="note">
          <p className="snippet-reference">{snippetReference({ slug: previewSnippet?.slug || preview.label })}</p>
          <p>{previewSnippet ? previewSnippet.content : "This snippet was deleted."}</p>
          {previewSnippet && !previewSnippet.enabled && <p className="hint">Turned off. Enable it or remove the reference before sending.</p>}
        </div>
      )}
      <div
        ref={editorRef}
        className={draftHasContent(parts) ? "snippet-editor hide-scrollbar" : "snippet-editor hide-scrollbar is-empty"}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        aria-autocomplete="list"
        aria-expanded={Boolean(token && suggestions.length)}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={syncFromDom}
        onPaste={(event) => {
          const root = editorRef.current;
          if (!root) return;
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          const range = selectionRange(root);
          const next = spliceDraft(parts, range.start, range.end, [{ kind: "text", text }], snippets);
          fromDom.current = false;
          setParts(next.parts);
          setCaret(next.caret);
        }}
        onMouseDown={(event) => {
          const chip = (event.target as HTMLElement).closest?.("[data-snippet-id]");
          if (!(chip instanceof HTMLElement) || !chip.dataset.snippetId) return;
          event.preventDefault();
          setPreviewId(chip.dataset.snippetId);
        }}
        onKeyDown={(event) => {
          const root = editorRef.current;
          if (!root || event.nativeEvent.isComposing) return;
          if (token && suggestions.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setSlashIndex((suggestions.length + suggestionIndex + delta) % suggestions.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const chosen = suggestions[suggestionIndex];
              if (chosen) insertSnippet(chosen);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              const next = spliceDraft(parts, token.start, caret, [], snippets);
              setParts(next.parts);
              setCaret(next.caret);
              return;
            }
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            const edited = editDraft(parts, selectionOffset(root), event.key === "Backspace" ? "backspace" : "delete", snippets);
            if (edited) {
              event.preventDefault();
              fromDom.current = false;
              setParts(edited.parts);
              setCaret(edited.caret);
              setPreviewId(null);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
            return;
          }
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            const next = spliceDraft(parts, selectionOffset(root), selectionOffset(root), [{ kind: "text", text: "\n" }], snippets);
            fromDom.current = false;
            setParts(next.parts);
            setCaret(next.caret);
          }
        }}
        onKeyUp={() => {
          const root = editorRef.current;
          if (root) setCaret(selectionOffset(root));
        }}
      />
      {problem && <p className="error" role="alert">{problem}</p>}
    </div>
  );
});
