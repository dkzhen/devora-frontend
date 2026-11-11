"use client";

import { Check, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { PrimaryLink } from "@/components/brand";
import { SectionHead } from "@/components/section-head";

type PlanPackage = {
  id: string;
  name: string;
  tier: string;
  category: "hard_cap" | "unlimited";
};

type PricingPlan = {
  id: string;
  displayName: string;
  displayDescription: string;
  features: string[];
  price: number;
  priceCredits: string;
  /** Rails this card accepts: IDR / CREDITS / USD. */
  paymentMethods: string[];
  package: PlanPackage;
};

function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

/**
 * Which rails a card advertises, in a stable order.
 *
 * Reads the plan's own `paymentMethods`; a legacy card with no list falls back to IDR,
 * the rail every pre-multi-select card was sold on. The old `priceCredits > 0` test
 * is gone — a card states its rails instead of inferring them from a second price column.
 */
function railsOf(plan: PricingPlan): string[] {
  const rails = plan.paymentMethods?.length ? plan.paymentMethods : ["IDR"];
  const order = ["IDR", "CREDITS", "USD"];
  return order.filter(r => rails.includes(r));
}

/** "via IDR", "via IDR or credits", "via IDR, credits or USD". */
function railsLabel(rails: string[]): string {
  const labels = rails.map(r => (r === "IDR" ? "IDR" : r === "CREDITS" ? "credits" : "USD"));
  if (labels.length <= 1) return `via ${labels[0] ?? "IDR"}`;
  return `via ${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** Truncate a description to ~100 chars for the compact landing card. */
function truncate(text: string, max = 100): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

const ACCENTS = ["mint", "coral", "violet"] as const;

export function LandingPricing() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/backend/api/v1/pricing-plans", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { data?: PricingPlan[] }) => {
        if (!cancelled) {
          setPlans(Array.isArray(data.data) ? data.data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && plans.length === 0) return null;

  return (
    <section className="land-pricing">
      <SectionHead tag="PRICING" heading="Packages that fit." accent="Start small, scale when ready." href="/pricing" linkLabel="See All Packages"/>

      <div className="pkg-grid">
        {loading
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className={`pkg-card pkg-card-${ACCENTS[i % 3]}`}
                aria-hidden="true"
              >
                <div className="pkg-card-top">
                  <span
                    className="pkg-icon"
                    style={{ animation: "land-pulse 1.6s ease-in-out infinite" }}
                  />
                </div>
                <div
                  style={{
                    height: 20,
                    width: "55%",
                    background: "#eae4d8",
                    animation: "land-pulse 1.6s ease-in-out infinite",
                  }}
                />
                <div
                  style={{
                    height: 14,
                    background: "#eae4d8",
                    animation: "land-pulse 1.6s ease-in-out infinite",
                  }}
                />
                <div
                  style={{
                    height: 14,
                    width: "75%",
                    background: "#eae4d8",
                    animation: "land-pulse 1.6s ease-in-out infinite",
                  }}
                />
              </div>
            ))
          : plans.slice(0, 3).map((plan, i) => (
              <article
                key={plan.id}
                className={`pkg-card pkg-card-${ACCENTS[i % 3]}`}
              >
                <div className="pkg-card-top">
                  <span className="plan-tag">{plan.package.tier}</span>
                </div>
                <h2 className="pkg-name">{plan.displayName}</h2>
                {plan.displayDescription && (
                  <p className="pkg-desc">{truncate(plan.displayDescription)}</p>
                )}

                {plan.features.length > 0 && (
                  <ul className="pkg-features">
                    {plan.features.slice(0, 3).map((f, idx) => (
                      <li key={idx}>
                        <Check size={13} /> {f}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="pkg-price">
                  {plan.price > 0 && (
                    <div><span className="pkg-price-idr">{plan.price.toLocaleString("id-ID")}</span></div>
                  )}
                  {plan.price > 0 && (
                    <div><span className="pkg-price-method">{railsLabel(railsOf(plan))}</span></div>
                  )}
                  {plan.price === 0 && (
                    <span className="pkg-price-free">Free</span>
                  )}
                </div>

                <div className="pkg-card-foot">
                  <PrimaryLink href="/pricing">View packages</PrimaryLink>
                </div>
              </article>
            ))}
      </div>
    </section>
  );
}
