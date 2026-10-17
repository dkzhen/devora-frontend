"use client";

import { useId } from "react";

/**
 * An on/off switch for a section of a form.
 *
 * A checkbox would work; this does not look like one on purpose. In a console where a stray
 * save can change someone's bill, the difference between "this section is ignored" and "this
 * section will be applied" has to be visible at a glance from across the desk, not inferred
 * from a small square. The label is the target, so the whole row is clickable and the state is
 * announced by `aria-checked` rather than by colour alone.
 */
export function Toggle({
  checked, onChange, label, hint, disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={disabled ? "toggle-row toggle-row-disabled" : "toggle-row"}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={checked ? "toggle toggle-on" : "toggle"}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" aria-hidden="true" />
        <span className="toggle-word" aria-hidden="true">{checked ? "ON" : "OFF"}</span>
      </button>
      <label className="toggle-label" htmlFor={id}>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </label>
    </div>
  );
}
