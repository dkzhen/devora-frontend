"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";
import styles from "./model-spotlights.module.css";

/**
 * A unified catalogue gallery sharing one live request.
 * Unavailable data and empty categories stay hidden.
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
            originalInput: m.pricing.originalInput, free: m.free,
          }));
        setDiscountModels(discounted);
      })
      .catch(() => { /* Stays hidden. */ });
    return () => { alive = false; };
  }, []);

  if (freeModels === null || discountModels === null) return null;

  // Interleave the bounded selections so both are visible near the start.
  const models = new Map<string, CardModel>();
  for (let i = 0; i < Math.max(freeModels.length, discountModels.length); i++) {
    for (const model of [freeModels[i], discountModels[i]]) {
      if (model && !models.has(model.id)) models.set(model.id, model);
    }
  }
  if (models.size === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="model-spotlights-title">
      <header className={styles.intro}>
        <div>
          <h2 id="model-spotlights-title">Model spotlights</h2>
          <p>A closer look at free models and current catalogue discounts.</p>
        </div>
        <a className={styles.browse} href="/models">Browse models <ArrowUpRight size={16} aria-hidden="true" /></a>
      </header>
      <ul className={styles.gallery}>
        {Array.from(models.values()).map(m => {
          const input = Number(m.input);
          const originalInput = m.originalInput === null ? NaN : Number(m.originalInput);
          const hasDiscount = m.input.trim() !== "" && m.originalInput?.trim() !== ""
            && Number.isFinite(input) && Number.isFinite(originalInput)
            && originalInput > 0 && input >= 0 && input < originalInput;
          const discount = hasDiscount ? (1 - input / originalInput) * 100 : null;
          const isFree = m.free || (m.input === "0" && m.output === "0");

          return (
            <li key={m.id} className={`${styles.tile} ${isFree ? styles.freeTile : styles.discountTile}`}>
              <div className={styles.provider}>
                <span className={styles.logo}><ProviderMark provider={m.provider ?? ""} size={22} /></span>
                <span>{m.provider ?? "—"}</span>
              </div>
              <h3>{m.name}</h3>
              <div className={styles.tags}>
                {isFree && <span className={styles.freeTag}>Free</span>}
                {m.free && <span className={styles.eventTag}>Event covered</span>}
                {discount !== null && (
                  <span className={styles.discountTag}>
                    {discount < 1 ? "<1" : Math.floor(discount)}% off input
                  </span>
                )}
              </div>
              <div className={styles.pricing}>
                <dl className={styles.rates}>
                  <div>
                    <dt>Input</dt>
                    <dd>
                      {hasDiscount && <s aria-label={`Original input rate: ${m.originalInput}`}>{m.originalInput}</s>}
                      <strong>{m.input}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd><strong>{m.output}</strong></dd>
                  </div>
                </dl>
                <p className={styles.unit}>credits per 1M tokens</p>
                {m.free && <p className={styles.eventNote}>Usage covered by an active event.</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
