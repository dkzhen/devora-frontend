"use client";

import { useEffect, useState } from "react";
import { formatCounter } from "@/lib/format-counter";

/**
 * Devora's headline figures, read live.
 *
 * All six come from one call to `/api/v1/stats` — the same payload the public stats page reads.
 * Using one source means a figure here cannot disagree with the same figure elsewhere, and the
 * two that the console also shows (accounts, credits spent) are computed from the same tables the
 * admin views use: `users`, and `usage_totals.charged_micro` rather than the prunable ledger, so
 * the headline does not shrink when an operator clears request history.
 *
 * No growth percentages and no comparisons — the page has no basis for either, and an invented
 * "+18%" is the fastest way to make real figures look made up.
 *
 * The block stays hidden until something has actually been served. A zeroed strip would advertise
 * the opposite of what it is there to show, so an empty or failed fetch renders nothing.
 */
type Stat = { value: string; label: string };

type FullStats = { providers?: number; accounts?: number; creditsSpent?: string };

export function GatewayStats() {
  const [stats, setStats] = useState<Stat[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/backend/api/v1/stats", { cache: "no-store" }).then(r => (r.ok ? r.json() : null))
      .then((full: FullStats & { requests?: number; totalTokens?: number; models?: number } | null) => {
        // Nothing served yet means nothing worth showing — the block stays hidden rather than
        // printing zeros, which would advertise the opposite of what it is there to prove.
        if (!alive || !full || !full.requests || full.requests <= 0) return;
        setStats([
          { value: formatCounter(full.totalTokens ?? 0), label: "Tokens processed" },
          { value: formatCounter(full.requests), label: "Requests served" },
          { value: formatCounter(full.creditsSpent ? Number(full.creditsSpent) : 0), label: "Credits spent" },
          { value: String(full.accounts ?? "—"), label: "Global users" },
          { value: typeof full.providers === "number" ? String(full.providers) : "—", label: "Providers" },
          { value: String(full.models ?? 0), label: "Models live" },
        ]);
      })
      .catch(() => { /* Stays hidden. The landing must not break over a stat block. */ });
    return () => { alive = false; };
  }, []);

  if (!stats) return null;

  return <section className="gateway-stats" id="gateway" aria-label="Devora in numbers">
    {/* One tag. A rename left the previous one in place, so two were rendering stacked — that
        was the leftover, not the wording. This is the heading the operator chose. */}
    <div className="section-tag">DEVORA IN NUMBERS</div>
    <div className="gs-grid">
      {stats.map(s => <div key={s.label} className="gs-cell">
        <strong>{s.value}</strong>
        <span>{s.label}</span>
      </div>)}
    </div>
  </section>;
}
