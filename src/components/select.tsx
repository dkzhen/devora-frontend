"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * A select that matches the console.
 *
 * The native `<select>` was replaced for a concrete reason, not taste: its popup is drawn by
 * the OS, so a themed trigger opens an unstyled list that ignores the page entirely, and the
 * only way to fake a themed arrow is a gradient hack that cannot be positioned reliably. The
 * other native control on the page — the plan pills — is a real element and reads fine; this
 * is the one that cannot be styled into place.
 *
 * What it keeps from the native control, because losing these is the usual cost of a custom
 * one: keyboard use (Up/Down/Home/End/Enter/Escape), the `aria-*` wiring a screen reader
 * reads, and focus returning to the trigger on close.
 */
export type Option = { value: string; label: string };

export function Select({
  value, options, onChange, label, placeholder, width, disabled = false,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** Accessible name — the visible label is often just the current value. */
  label: string;
  /** Shown on the trigger when `value` matches no option. */
  placeholder?: string;
  width?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = options.find(o => o.value === value);

  // Close on an outside click. `mousedown` rather than `click` so the menu is gone before
  // the click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Opening starts on the selected row, so the keyboard continues from where it was.
  useEffect(() => {
    if (open) setActive(Math.max(options.findIndex(o => o.value === value), 0));
  }, [open, options, value]);

  // Keep the active row in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    switch (e.key) {
      case "Escape": e.preventDefault(); setOpen(false); triggerRef.current?.focus(); break;
      case "ArrowDown": e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); break;
      case "ArrowUp": e.preventDefault(); setActive(i => Math.max(i - 1, 0)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(options.length - 1); break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (options[active]) commit(options[active].value);
        break;
      case "Tab": setOpen(false); break;
    }
  };

  return (
    <div className="ui-select" ref={rootRef} style={width ? { width } : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "ui-select-trigger ui-select-open" : "ui-select-trigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        title={disabled ? label : undefined}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onKey}
      >
        <span className={current ? "ui-select-value" : "ui-select-value ui-select-placeholder"}>
          {current?.label ?? placeholder ?? "—"}
        </span>
        <ChevronDown size={14} className="ui-select-chevron"/>
      </button>

      {open && (
        <ul className="ui-select-list" role="listbox" aria-label={label} ref={listRef}>
          {options.map((o, i) => (
            <li
              key={o.value === "" ? "__all" : o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className={`ui-select-option${o.value === value ? " ui-select-option-on" : ""}${i === active ? " ui-select-option-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              // `mousedown` would be swallowed by the outside-click handler racing it; click
              // fires after, which is what we want.
              onClick={() => commit(o.value)}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={13}/>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
