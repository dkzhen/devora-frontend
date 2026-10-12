"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A modal that matches the console's neubrutalist theme.
 *
 * Replaces `window.prompt` / `window.confirm`, which cannot be styled, sit outside the
 * page's visual language, and — for prompts — grey out the browser and refuse to show what
 * the app knows (the account being changed, its current balance).
 *
 * Three behaviours are deliberate and easy to get wrong:
 *
 *  - Escape closes, unless `busy`. Dismissing mid-write would leave the caller unsure
 *    whether it happened.
 *  - The dialog is rendered where it is placed, not via a portal, so it inherits the page's
 *    CSS variables. A portal into `document.body` would drop the `:root` tokens the theme
 *    is built from unless they were re-declared.
 *  - Focus moves to the first field on open and returns to whatever had focus on close, so
 *    keyboard use does not silently lose its place.
 */
export function Modal({
  open, title, subtitle, onClose, children, footer, busy = false, tone = "default", wide = false,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  busy?: boolean;
  tone?: "default" | "danger";
  /** Widens the panel for side-by-side content. Request/response bodies need the room. */
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    // Remembered, not assumed: the trigger may be a row button in a table that re-renders.
    restoreRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    };
    document.addEventListener("keydown", onKey);

    // Land on the first field if there is one, else the panel itself — a dialog with no
    // focusable child would otherwise leave focus on the page behind it.
    const target = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([disabled])",
    );
    (target ?? panelRef.current)?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="modal-scrim"
      // Clicking the backdrop closes; clicking inside the panel must not, hence the guard.
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={panelRef}
        className={["modal-panel", tone === "danger" && "modal-panel-danger", wide && "modal-panel-wide"].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" type="button" onClick={close} disabled={busy} aria-label="Close">
            <X size={16}/>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}
