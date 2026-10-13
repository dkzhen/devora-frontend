"use client";

import { formatCounter } from "@/lib/format-counter";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Layers } from "lucide-react";

/* Lifetime figures on the landing page.
 *
 * Facts, not projections: every number is read from the all-time snapshot, so it can only
 * ever move upward and it stays true after history is pruned. No growth percentages and no
 * comparisons — the page has no basis for either, and an invented "+18%" is the fastest way
 * to make real figures look made up.
 *
 * The whole block is omitted when the fetch fails or nothing has been served yet. An empty
 * or zeroed strip would be worse than none: it would advertise the opposite of what it is
 * there to show. */

type Spotlight = { requests: number; totalTokens: number; models: number };

const full = (n: number): string => n.toLocaleString("en-US");

export function LandingSpotlight() {
  const [data, setData] = useState<Spotlight | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/backend/api/v1/stats/spotlight", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Spotlight | null) => { if (alive && d && d.requests > 0) setData(d); })
      .catch(() => { /* Stays hidden. The landing must not break over a stat strip. */ });
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  const cells = [
    { icon: Activity, label: "Requests served", value: formatCounter(data.requests), sub: `${full(data.requests)} in total` },
    { icon: Layers, label: "Tokens processed", value: formatCounter(data.totalTokens), sub: `${full(data.totalTokens)} input and output` },
    { icon: ArrowUpRight, label: "Models live", value: full(data.models), sub: "Behind one endpoint" },
  ];

  return <section className="spot" aria-label="Devora service figures">
    <div className="spot-head">
      <span className="section-tag">IN NUMBERS</span>
      {/* Says what these are, so a reader does not have to guess whether they are demo
          values. The link is the reason the strip exists at all. */}
      <p className="spot-note">
        Live from the gateway. <Link href="/stats">See the full stats <ArrowUpRight size={13}/></Link>
      </p>
    </div>
    <div className="spot-grid">
      {cells.map(c => {
        const Icon = c.icon;
        return <div key={c.label} className="spot-cell">
          <div className="spot-cell-top"><Icon size={15}/><span>{c.label}</span></div>
          <strong>{c.value}</strong>
          <small>{c.sub}</small>
        </div>;
      })}
    </div>
  </section>;
}
