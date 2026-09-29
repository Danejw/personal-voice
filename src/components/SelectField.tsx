import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  /** `stack` puts the label above a full-width control. Default is one row. */
  layout?: "row" | "stack";
  onChange(value: string): void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

/** Branded dropdown used for every select in the app. Same API as the old native select. */
export function SelectField({
  label,
  value,
  options,
  disabled = false,
  layout = "row",
  onChange,
}: SelectFieldProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const activeIndexRef = useRef(-1);
  const optionsRef = useRef(options);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  optionsRef.current = options;
  activeIndexRef.current = activeIndex;

  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedLabel = selected?.label ?? "";

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    setMenu(null);
  }

  function choose(next: string) {
    onChange(next);
    close();
    triggerRef.current?.focus();
  }

  function placeMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = Math.min(optionsRef.current.length * 36 + 12, 280);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    setMenu({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      openUp,
    });
  }

  function toggle() {
    if (disabled) return;
    if (open) {
      close();
      return;
    }
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    setActiveIndex(index);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      const currentOptions = optionsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % currentOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? currentOptions.length - 1 : current - 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(currentOptions.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = currentOptions[activeIndexRef.current];
        if (option) choose(option.value);
      }
    }

    function onViewportChange() {
      placeMenu();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, onChange]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  return (
    <div ref={rootRef} className={layout === "stack" ? "field stack select-field" : "field select-field"}>
      <span className="select-field-label" id={`${listId}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "select-trigger is-open" : "select-trigger"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label`}
        aria-controls={listId}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) toggle();
            return;
          }
          // Keep Space/Enter from re-clicking the trigger while the menu is open.
          if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
          }
        }}
      >
        <span className="select-trigger-value">{selectedLabel}</span>
        <span className="select-trigger-chevron" aria-hidden="true">
          <svg viewBox="0 0 12 12">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && menu && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className={menu.openUp ? "select-menu is-up hide-scrollbar" : "select-menu hide-scrollbar"}
          role="listbox"
          aria-labelledby={`${listId}-label`}
          style={{
            top: menu.openUp ? undefined : menu.top,
            bottom: menu.openUp ? window.innerHeight - menu.top : undefined,
            left: menu.left,
            width: menu.width,
          }}
        >
          {options.map((option, index) => {
            const selectedOption = option.value === value;
            const active = index === activeIndex;
            return (
              <li key={`${option.value}:${option.label}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  data-index={index}
                  className={[
                    "select-option",
                    selectedOption ? "is-selected" : "",
                    active ? "is-active" : "",
                  ].filter(Boolean).join(" ")}
                  aria-selected={selectedOption}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.value)}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
