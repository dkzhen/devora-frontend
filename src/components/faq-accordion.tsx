"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

/**
 * The disclosure list used by /events, extracted so the landing page can carry the same control
 * rather than a lookalike.
 *
 * A real disclosure: a `button` with `aria-expanded` and `aria-controls`, not a div with a click
 * handler — so it opens from the keyboard and reads correctly to a screen reader. One row is open
 * at a time; opening another closes the first, which keeps a long list from turning into a wall.
 *
 * `id` is per instance: two accordions on different pages must not share anchor ids.
 */
export type FaqItem = { q: string; a: string };

export function FaqAccordion({ id, items }: { id: string; items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return <div className="ev-faq-list">
    {items.map((item, i) => {
      const isOpen = open === i;
      return <div className={isOpen ? "ev-faq-item is-open" : "ev-faq-item"} key={item.q}>
        <h3>
          <button
            className="ev-faq-q"
            type="button"
            aria-expanded={isOpen}
            aria-controls={`${id}-a-${i}`}
            onClick={() => setOpen(isOpen ? null : i)}
          >
            <span>{item.q}</span>
            <Plus className="ev-faq-icon" size={18} aria-hidden="true"/>
          </button>
        </h3>
        <div className="ev-faq-a" id={`${id}-a-${i}`} role="region" hidden={!isOpen}>
          <p>{item.a}</p>
        </div>
      </div>;
    })}
  </div>;
}
