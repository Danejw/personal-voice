import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, type DestructiveAction } from "@/components/ConfirmDialog";

describe("shared destructive action confirmation", () => {
  it("renders the requested destructive action and a safe Cancel control", () => {
    const action: DestructiveAction = {
      title: "Delete note?",
      description: "“Meeting notes” and its attachments will be deleted.",
      confirmLabel: "Delete note",
      onConfirm: vi.fn(),
    };
    const close = vi.fn();
    const markup = renderToStaticMarkup(createElement(ConfirmDialog, { request: action, onClose: close }));
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('Delete note?');
    expect(markup).toContain('Meeting notes');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('>Delete note</button>');
    expect(markup).toMatch(/autofocus/i); // The initial safe button is auto-focused.
    expect(action.onConfirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("escapes untrusted item names and never executes the action while rendering", () => {
    const onConfirm = vi.fn();
    const markup = renderToStaticMarkup(createElement(ConfirmDialog, {
      request: {
        title: "Delete snippet?",
        description: "Remove <script>alert('hi')</script>?",
        confirmLabel: "Delete snippet",
        onConfirm,
      },
      onClose: vi.fn(),
    }));
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders no active destructive action while the confirmation request is empty", () => {
    const markup = renderToStaticMarkup(createElement(ConfirmDialog, { request: null, onClose: vi.fn() }));
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Delete snippet?");
  });
});
