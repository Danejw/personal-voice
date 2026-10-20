import type { Snippet } from "@/snippets/snippet";
import { normalizeParts, refreshSnippetLabels, type SnippetDraftPart } from "@/snippets/snippetDraft";

/** Reads the composer DOM back into draft parts. Chips keep their snippet id. */
export function readEditor(root: HTMLElement): SnippetDraftPart[] {
  const parts: SnippetDraftPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };
  const walk = (node: Node) => {
    if (node instanceof HTMLBRElement) {
      pushText("\n");
      return;
    }
    if (node instanceof HTMLElement && node.dataset.snippetId) {
      const label = node.dataset.snippetLabel || node.textContent?.replace(/^@/, "") || "snippet";
      parts.push({ kind: "snippet", id: node.dataset.snippetId, label });
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "");
      return;
    }
    [...node.childNodes].forEach((child, index) => {
      const block = child instanceof HTMLElement && (child.tagName === "DIV" || child.tagName === "P");
      if (block && index > 0) pushText("\n");
      walk(child);
    });
  };
  walk(root);
  return normalizeParts(parts);
}

export function writeEditor(root: HTMLElement, parts: readonly SnippetDraftPart[], snippets: readonly Snippet[]): void {
  const fragment = root.ownerDocument.createDocumentFragment();
  for (const part of refreshSnippetLabels(parts, snippets)) {
    if (part.kind === "text") {
      part.text.split("\n").forEach((line, index) => {
        if (index > 0) fragment.append(root.ownerDocument.createElement("br"));
        if (line) fragment.append(root.ownerDocument.createTextNode(line));
      });
      continue;
    }
    const snippet = snippets.find((item) => item.id === part.id);
    const chip = root.ownerDocument.createElement("span");
    chip.dataset.snippetId = part.id;
    chip.dataset.snippetLabel = part.label;
    chip.setAttribute("contenteditable", "false");
    chip.className = snippet?.enabled ? "snippet-token" : "snippet-token is-missing";
    chip.textContent = `@${part.label}`;
    fragment.append(chip);
  }
  root.replaceChildren(fragment);
}

export function selectionOffset(root: HTMLElement): number {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode || !root.contains(selection.focusNode)) return 0;
  return offsetAt(root, selection.focusNode, selection.focusOffset);
}

export function selectionRange(root: HTMLElement): { start: number; end: number } {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
    const end = selectionOffset(root);
    return { start: end, end };
  }
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    const end = selectionOffset(root);
    return { start: end, end };
  }
  const anchor = offsetAt(root, selection.anchorNode, selection.anchorOffset);
  const focus = offsetAt(root, selection.focusNode, selection.focusOffset);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

export function placeCaret(root: HTMLElement, offset: number): void {
  const point = pointAt(root, offset);
  const selection = root.ownerDocument.getSelection();
  if (!point || !selection) return;
  const range = root.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function offsetAt(root: HTMLElement, target: Node, targetOffset: number): number {
  if (target === root) {
    let count = 0;
    for (let index = 0; index < targetOffset && index < root.childNodes.length; index += 1) {
      count += nodeSize(root.childNodes[index]!);
    }
    return count;
  }
  let count = 0;
  const walk = (node: Node): boolean => {
    if (node === target) {
      count += target.nodeType === Node.TEXT_NODE ? targetOffset : 0;
      return true;
    }
    if (node instanceof HTMLElement && node.dataset.snippetId) {
      count += node.textContent?.length ?? 0;
      return node.contains(target);
    }
    if (node instanceof HTMLBRElement) {
      count += 1;
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length ?? 0;
      return false;
    }
    for (const child of node.childNodes) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(root);
  return count;
}

function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } | null {
  let remaining = Math.max(0, offset);
  const visit = (parent: Node): { node: Node; offset: number } | null => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (!child) continue;
      if (child instanceof HTMLElement && child.dataset.snippetId) {
        const size = child.textContent?.length ?? 0;
        if (remaining <= 0) return { node: parent, offset: index };
        remaining -= size;
        if (remaining <= 0) return { node: parent, offset: index + 1 };
        continue;
      }
      if (child instanceof HTMLBRElement) {
        if (remaining <= 0) return { node: parent, offset: index };
        remaining -= 1;
        if (remaining <= 0) return { node: parent, offset: index + 1 };
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const size = child.textContent?.length ?? 0;
        if (remaining <= size) return { node: child, offset: remaining };
        remaining -= size;
        continue;
      }
      const nested = visit(child);
      if (nested) return nested;
    }
    return null;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
}

function nodeSize(node: Node): number {
  if (node instanceof HTMLBRElement) return 1;
  if (node instanceof HTMLElement && node.dataset.snippetId) return node.textContent?.length ?? 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  return [...node.childNodes].reduce((total, child) => total + nodeSize(child), 0);
}
