"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";
import { formatCounter } from "@/lib/format-counter";
import { SectionHead } from "@/components/section-head";

/**
 * The three busiest models, as live data cards.
 *
 * A different card grammar from the grid above it, on purpose. That grid is editorial — tag,
 * headline, paragraph, decoration. This one is a product card: one model each, and the figure is
 * the subject while the name is its caption. The distinction is not decoration; the section above
 * makes claims and this one shows evidence, and they should not read as one set.
 *
 * The skin is the house's — 2px ink border, hard offset shadow, no corner radius — because an
 * earlier pass borrowed a soft 14px-radius card from generic SaaS and it read as a foreign object.
 * What differs from the grid above is the arrangement, not the styling.
 *
 * The share figure is computed the same way `/stats` computes it (tokens over the grand total), so
 * a model reads as the same percentage in both places. A different formula here would quietly
 * contradict the page it is drawn from.
 */
type TrafficModel = {
  id: string;
  name: string | null;
  provider: string | null;
  requests: number;
  totalTokens: number;
};

export function FeaturedModels() {
  const [data, setData] = useState<{ models: TrafficModel[]; grandTotal: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/backend/api/v1/stats", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { modelBreakdown?: TrafficModel[]; totalTokens?: number } | null) => {
        const all = Array.isArray(d?.modelBreakdown) ? d!.modelBreakdown : [];
        // Nothing served yet means nothing to show. Three zeroed cards would advertise the
        // opposite of what this section is for.
        if (alive && all.length > 0) {
          setData({ models: all.slice(0, 3), grandTotal: d?.totalTokens ?? 0 });
        }
      })
      .catch(() => { /* Stays hidden. A stat block must not break the page. */ });
    return () => { alive = false; };
  }, []);

  return <section className="features-section" id="operate" aria-label="Busiest models">
    <SectionHead tag="FEATURED MODELS" heading="Busiest right now," accent="counted live." href="/models" linkLabel="View All"/>

    {data === null
      ? null
      : <div className="data-grid">
          {data.models.map((m, i) => {
            const share = data.grandTotal > 0 ? (m.totalTokens / data.grandTotal) * 100 : 0;
            // Tokens per request says more about how a model is used than either figure alone —
            // a chat model and a long-document model differ by orders of magnitude here.
            const perRequest = m.requests > 0 ? m.totalTokens / m.requests : 0;
            return <article key={m.id} className={`data-card data-card-tint-${["mint", "coral", "violet"][i % 3]}`}>
              <div className="data-card-top">
                {m.provider
                  ? <ProviderMark provider={m.provider} size={36}/>
                  : <span className="data-card-fallback"><Layers size={19}/></span>}
                <div className="data-card-id">
                  <strong>{m.name ?? m.id.replace(/^devora-\d+\//, "")}</strong>
                  {m.provider && <small>by {m.provider}</small>}
                </div>
              </div>

              <div className="data-card-rule" role="presentation"/>

              {/* The two totals, in opposite corners so a column of three scans straight down. */}
              <div className="data-card-facts">
                <div>
                  <span>Tokens</span>
                  <strong>{formatCounter(m.totalTokens)}</strong>
                </div>
                <div>
                  <span>Requests</span>
                  <strong>{formatCounter(m.requests)}</strong>
                </div>
              </div>

              {/* Share of the gateway's tokens. The bar carries the comparison; the label states
                  it exactly, so the reader is not estimating from a length. */}
              <div className="data-card-share">
                <div className="data-card-bar" role="presentation">
                  <span style={{ width: `${Math.max(share, 1)}%` }}/>
                </div>
                <div className="data-card-share-meta">
                  <span>{share >= 0.1 ? `${share.toFixed(1)}%` : "<0.1%"}</span>
                  <span>of gateway tokens</span>
                </div>
              </div>

              <div className="data-card-foot">
                <span>Tokens / request</span>
                <strong>{m.requests > 0 ? formatCounter(Math.round(perRequest)) : "—"}</strong>
              </div>
            </article>;
          })}
        </div>}
  </section>;
}
