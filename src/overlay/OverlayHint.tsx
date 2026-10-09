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
  const hovered = useRef(false);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  // An older async show must never arrive after its own hide request.
  const publish = (message: string | null) => {
    pending.current = pending.current
      .then(() => invoke("sync_overlay_feedback", { channel: "hint", id, message }))
      .catch(() => undefined);
  };
  const show = () => {
    hovered.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!content.trim()) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      publish(content);
    }, delayMs);
  };
  const hide = () => {
    hovered.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!forceOpen) publish(null);
  };
  useEffect(() => {
    if (forceOpen) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      publish(content);
    } else if (hovered.current && timer.current === null) {
      publish(content);
    } else if (!hovered.current) {
      publish(null);
    }
  }, [forceOpen, content, id]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    publish(null);
  }, [id]);
  return (
    <span className="overlay-hint-trigger" onPointerEnter={show} onPointerLeave={hide}
      onFocusCapture={show} onBlurCapture={hide}>
      {children}
    </span>
  );
}
