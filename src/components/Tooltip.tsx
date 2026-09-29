import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

type TooltipSide = "left" | "right";

interface TooltipProps {
  /** Hover/focus text. Omit or empty to render the child unchanged. */
  content?: string;
  /**
   * Preferred side. When omitted, the tip picks left or right based on
   * whichever side of the trigger has more room. When set, that side is kept
   * even if the tip has to sit closer to the edge.
   */
  side?: TooltipSide;
  /** Delay before the tip appears, like a native title. */
  delayMs?: number;
  children: ReactElement;
}

interface TipPosition {
  top: number;
  left: number;
  side: TooltipSide;
  /** Vertical offset of the arrow tip, relative to the tooltip box. */
  arrowTop: number;
}

/**
 * Branded tooltip for the whole app. Prefer this over the native `title` attribute
 * so tips match our colors and are not clipped by overflow parents.
 */
export function Tooltip({ content, side, delayMs = 350, children }: TooltipProps) {
  const tipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPosition | null>(null);

  const text = content?.trim() ?? "";
  const child = Children.only(children);

  function clearTimer() {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function hide() {
    clearTimer();
    setOpen(false);
    setPos(null);
  }

  function scheduleShow() {
    if (!text) return;
    clearTimer();
    showTimer.current = window.setTimeout(() => setOpen(true), delayMs);
  }

  function place() {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;

    const gap = 10;
    const edge = 8;
    const rect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const spaceLeft = rect.left - edge;
    const spaceRight = window.innerWidth - rect.right - edge;
    const needs = tipRect.width + gap;

    let nextSide: TooltipSide = side ?? (spaceLeft >= spaceRight ? "left" : "right");
    // Only auto-flip when the caller did not lock a side.
    if (!side) {
      const preferredFits = nextSide === "left" ? spaceLeft >= needs : spaceRight >= needs;
      const otherFits = nextSide === "left" ? spaceRight >= needs : spaceLeft >= needs;
      if (!preferredFits && otherFits) {
        nextSide = nextSide === "left" ? "right" : "left";
      }
    }

    let left = nextSide === "left"
      ? rect.left - tipRect.width - gap
      : rect.right + gap;
    // Keep the tip on-screen without flipping a locked side.
    left = Math.min(Math.max(edge, left), Math.max(edge, window.innerWidth - tipRect.width - edge));

    let top = rect.top + rect.height / 2 - tipRect.height / 2;
    top = Math.min(Math.max(edge, top), window.innerHeight - tipRect.height - edge);

    const triggerMidY = rect.top + rect.height / 2;
    const arrowTop = Math.min(
      Math.max(10, triggerMidY - top),
      tipRect.height - 10,
    );

    setPos({ top, left, side: nextSide, arrowTop });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, text, side]);

  useEffect(() => {
    if (!open) return;
    function onViewportChange() {
      place();
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  if (!text || !isValidElement(child)) {
    return child;
  }

  const trigger = child as ReactElement<{
    ref?: ((node: HTMLElement | null) => void) | { current: HTMLElement | null } | null;
    onMouseEnter?: (event: MouseEvent) => void;
    onMouseLeave?: (event: MouseEvent) => void;
    onFocus?: (event: FocusEvent) => void;
    onBlur?: (event: FocusEvent) => void;
    "aria-describedby"?: string;
  }>;

  return (
    <>
      {cloneElement(trigger, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          const existing = trigger.props.ref;
          if (typeof existing === "function") existing(node);
          else if (existing && typeof existing === "object") existing.current = node;
        },
        onMouseEnter: (event: MouseEvent) => {
          trigger.props.onMouseEnter?.(event);
          scheduleShow();
        },
        onMouseLeave: (event: MouseEvent) => {
          trigger.props.onMouseLeave?.(event);
          hide();
        },
        onFocus: (event: FocusEvent) => {
          trigger.props.onFocus?.(event);
          scheduleShow();
        },
        onBlur: (event: FocusEvent) => {
          trigger.props.onBlur?.(event);
          hide();
        },
        "aria-describedby": open ? tipId : trigger.props["aria-describedby"],
      })}
      {open && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className={pos ? `app-tooltip is-${pos.side}` : "app-tooltip"}
          style={pos
            ? { top: pos.top, left: pos.left, ["--tooltip-arrow" as string]: `${pos.arrowTop}px` }
            : { top: -9999, left: -9999, visibility: "hidden" }}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
