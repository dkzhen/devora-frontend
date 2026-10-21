"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";

/**
 * Two side-by-side cards that surface discounted and free models from the live catalogue.
 *
 * Sits directly below "Devora in numbers". Both cards read the same /api/v1/models endpoint
 * and split the list by price + event status — one fetch, two views.
 *
 * Visual style matches the neobrutalist cards on the rest of the page: 2px ink border,
 * 4px hard shadow, solid color header strip, clean body.
 */
type Model = {
  id: string;
  name: string;
  provider: string | null;
  free: boolean;
  pricing: {
    input: string;
    output: string;
    originalInput: string | null;
    originalOutput: string | null;
  };
};

type CardModel = {
  id: string;
  name: string;
  provider: string | null;
  input: string;
  output: string;
  originalInput: string | null;
  free: boolean;
};

export function ModelSpotlights() {
  const [freeModels, setFreeModels] = useState<CardModel[] | null>(null);
  const [discountModels, setDiscountModels] = useState<CardModel[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/backend/api/v1/models", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { data?: Model[] } | null) => {
        if (!alive || !d?.data) return;
        const all = d.data;

        const free = all
          .filter(m => m.free || (m.pricing.input === "0" && m.pricing.output === "0"))
          .slice(0, 5)
          .map(m => ({
            id: m.id, name: m.name, provider: m.provider,
            input: m.pricing.input, output: m.pricing.output,
            originalInput: m.pricing.originalInput, free: m.free,
          }));
        setFreeModels(free);

        const discounted = all
          .filter(m => m.pricing.originalInput !== null && m.pricing.originalInput !== m.pricing.input)
          .slice(0, 5)
          .map(m => ({
            id: m.id, name: m.name, provider: m.provider,
            input: m.pricing.input, output: m.pricing.output,
            originalInput: m.pricing.originalInput, free: false,
          }));
        setDiscountModels(discounted);
      })
      .catch(() => { /* Stays hidden. */ });
    return () => { alive = false; };
  }, []);

  if (freeModels === null || discountModels === null) return null;

  const hasFree = freeModels.length > 0;
  const hasDiscount = discountModels.length > 0;
  if (!hasFree && !hasDiscount) return null;

  return (
    <section className="model-spotlights" aria-label="Free and discounted models">
      {hasFree && (
        <article className="spotlight-card spotlight-free">
          <div className="spotlight-head">
            <h3>Free models</h3>
            <p>Event-covered or zero-priced — no credits spent.</p>
          </div>
          <div className="spotlight-body">
            <ul className="spotlight-list">
              {freeModels.map(m => (
                <li key={m.id}>
                  <ProviderMark provider={m.provider ?? ""} size={20}/>
                  <div className="spotlight-model-info">
                    <strong>{m.name}</strong>
                    <span>{m.provider ?? "—"}</span>
                  </div>
                  {m.free && <span className="spotlight-badge spotlight-badge-event">EVENT</span>}
                  <span className="spotlight-price spotlight-price-free">Free</span>
                </li>
              ))}
            </ul>
            <a className="spotlight-foot" href="/models">Browse all models <ArrowUpRight size={14}/></a>
          </div>
        </article>
      )}
      {hasDiscount && (
        <article className="spotlight-card spotlight-discount">
          <div className="spotlight-head">
            <h3>Discounted models</h3>
            <p>Reduced input/output rates — limited time.</p>
          </div>
          <div className="spotlight-body">
            <ul className="spotlight-list">
              {discountModels.map(m => {
                const inPct = m.originalInput && Number(m.input) > 0
                  ? Math.round((1 - Number(m.input) / Number(m.originalInput)) * 100) : null;
                return (
                  <li key={m.id}>
                    <ProviderMark provider={m.provider ?? ""} size={20}/>
                    <div className="spotlight-model-info">
                      <strong>{m.name}</strong>
                      <span>{m.provider ?? "—"}</span>
                    </div>
                    {inPct !== null && <span className="spotlight-badge spotlight-badge-off">-{inPct}%</span>}
                    <div className="spotlight-price spotlight-price-discount">
                      <s>{m.originalInput}</s>
                      <strong>{m.input}</strong>
                    </div>
                  </li>
                );
              })}
            </ul>
            <a className="spotlight-foot" href="/models">Browse all models <ArrowUpRight size={14}/></a>
          </div>
        </article>
      )}
    </section>
  );
}
