"use client";

import { LandingNav } from "@/components/landing-nav";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Gift, Infinity as InfinityIcon, Loader2, Package, Sparkles, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { PublicFooter } from "@/components/public-footer";
import { formatTokens } from "@/lib/tokens";

/**
 * The linked package behind a pricing plan — the actual entitlement. The card
 * shows the marketing copy (display name, features, price) and the package's
 * specs (allowance, duration, rpm) so the buyer knows what they get.
 */
type PlanPackage = {
  id: string;
  name: string;
  tier: string;
  category: "hard_cap" | "unlimited";
  durationDays: number | null;
  tokenCap: string | null;
  fairUseCap: string | null;
  baseRpm: number | null;
  throttledRpm: number | null;
  modelCount: number;
};

/**
 * A pricing plan as the public endpoint returns it: a marketing card (display
 * name, description, feature bullets, price) linked to a package that provides
 * the actual entitlement.
 */
type PricingPlan = {
  id: string;
  displayName: string;
  displayDescription: string;
  features: string[];
  priceIdr: number;
  priceCredits: string;
  package: PlanPackage;
};

/** Format an IDR price: 1500000 → "Rp 1.500.000". */
function formatIdr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

export function PricingPage() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/pricing-plans", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { data?: PricingPlan[] };
      setPlans(Array.isArray(data.data) ? data.data : []);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <main className="landing events-landing">
    <LandingNav/>

    <section className="mp-head">
      <div className="section-tag"><Package size={13}/> PRICING</div>
      <h1>Pricing</h1>
      <p>Subscription packages bundle an allowance — a token ceiling, or an open plan that slows past fair use. Redeem a voucher to activate one.</p>
    </section>

    <section className="mp-body">
      {status === "loading" && <div className="land-pricing-state"><Loader2 size={20} className="row-spinner"/><strong>Loading plans…</strong></div>}
      {status === "error" && <div className="land-pricing-state"><Zap size={20}/><strong>Could not load plans</strong><button className="button button-outline compact-button" type="button" onClick={() => void load()}>Try again</button></div>}
      {status === "ready" && plans.length === 0 && <div className="land-pricing-state">
        <Gift size={20}/><strong>No public plans yet</strong>
        <p>Everything in the catalogue is still available from your console on pay-as-you-go credits.</p>
      </div>}

      {status === "ready" && plans.length > 0 && <div className="pkg-grid">
        {plans.map((plan, i) => {
          const pkg = plan.package;
          const unlimited = pkg.category === "unlimited";
          const granted = unlimited ? pkg.fairUseCap : pkg.tokenCap;
          return <article key={plan.id} className={`pkg-card pkg-card-${["mint", "coral", "violet"][i % 3]}`}>
            <div className="pkg-card-top">
              <span className="pkg-icon">{unlimited ? <InfinityIcon size={20}/> : <Sparkles size={20}/>}</span>
              <span className="plan-tag">{pkg.tier}</span>
            </div>
            <h2 className="pkg-name">{plan.displayName}</h2>
            {plan.displayDescription && <p className="pkg-desc">{plan.displayDescription}</p>}

            {plan.features.length > 0 && <ul className="pkg-features">
              {plan.features.map((f, idx) => <li key={idx}><Check size={13}/> {f}</li>)}
            </ul>}

            <div className="pkg-price">
              {plan.priceIdr > 0 && <span className="pkg-price-idr">{formatIdr(plan.priceIdr)}</span>}
              {plan.priceIdr > 0 && plan.priceCredits !== "0" && plan.priceCredits !== "" && <span className="pkg-price-or">or</span>}
              {plan.priceCredits !== "0" && plan.priceCredits !== "" && <span className="pkg-price-credits">{plan.priceCredits} credits</span>}
              {plan.priceIdr === 0 && (plan.priceCredits === "0" || plan.priceCredits === "") && <span className="pkg-price-free">Free</span>}
            </div>

            <dl className="pkg-facts">
              <div>
                <dt>{unlimited ? "Fair use" : "Token allowance"}</dt>
                <dd>{granted ? formatTokens(Number(granted)) : "—"}<small>tokens</small></dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{pkg.durationDays === null ? "Lifetime" : `${pkg.durationDays}`}<small>{pkg.durationDays === null ? "" : "days"}</small></dd>
              </div>
              <div>
                <dt>Request rate</dt>
                <dd>{pkg.baseRpm === null ? "Unlimited" : `${pkg.baseRpm}`}<small>rpm</small></dd>
              </div>
            </dl>

            <p className="pkg-outcome">
              {unlimited
                ? <>Past fair use, requests continue at <strong>{pkg.throttledRpm ?? "a reduced"} rpm</strong> — never cut off.</>
                : <>Once the allowance is spent, the plan ends and your account falls back to <strong>pay-as-you-go credits</strong>.</>}
            </p>

            <div className="pkg-card-foot">
              <PrimaryLink href="/auth?next=%2Fconsole%2Fvouchers">Get started</PrimaryLink>
            </div>
          </article>;
        })}
      </div>}

      <div className="pkg-note">
        <Check size={15}/> Every plan grants the same models the SUBSCRIPTION tier can reach; pay-as-you-go credits and running events work alongside it.
      </div>
    </section>

    <PublicFooter/>
  </main>;
}
