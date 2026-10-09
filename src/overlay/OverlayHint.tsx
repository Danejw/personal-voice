import { useEffect, useId, useRef, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_DELAY = 280;

/** Hover and tap-cycle feedback lives in its own native window, not the tray HWND. */
export function OverlayHint({ content, children, delayMs = DEFAULT_DELAY, forceOpen = false }: {
  content: string;
  children: ReactElement;
  delayMs?: number;
  forceOpen?: boolean;
}) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!content.trim()) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void invoke("sync_overlay_feedback", { channel: "hint", id, message: content }).catch(() => undefined);
    }, delayMs);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!forceOpen) void invoke("sync_overlay_feedback", { channel: "hint", id, message: null }).catch(() => undefined);
  };
  useEffect(() => {
    if (forceOpen) {
      if (timer.current) clearTimeout(timer.current);
      void invoke("sync_overlay_feedback", { channel: "hint", id, message: content }).catch(() => undefined);
    } else {
      void invoke("sync_overlay_feedback", { channel: "hint", id, message: null }).catch(() => undefined);
    }
  }, [forceOpen, content, id]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    void invoke("sync_overlay_feedback", { channel: "hint", id, message: null }).catch(() => undefined);
  }, [id]);
  return (
    <span className="overlay-hint-trigger" onPointerEnter={show} onPointerLeave={hide}
      onFocusCapture={show} onBlurCapture={hide}>
      {children}
    </span>
  );
}
