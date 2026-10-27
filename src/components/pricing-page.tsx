"use client";

import { LandingNav } from "@/components/landing-nav";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Gift, Infinity as InfinityIcon, Loader2, Package, Sparkles, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { PublicFooter } from "@/components/public-footer";
import { ProviderMark } from "@/components/provider-mark";
import { Modal } from "@/components/modal";
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
  models?: { name: string; provider: string }[];
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
  const [modelPopup, setModelPopup] = useState<{ models: { name: string; provider: string }[]; name: string } | null>(null);

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
                <dt>Token allowance</dt>
                <dd>{unlimited
                  ? <span>Unlimited</span>
                  : <>{granted ? formatTokens(Number(granted)) : "—"}<small>tokens</small></>
                }</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{pkg.durationDays === null ? "Lifetime" : `${pkg.durationDays}`}<small>{pkg.durationDays === null ? "" : "days"}</small></dd>
              </div>
              <div>
                <dt>Request rate</dt>
                <dd>
                  {unlimited
                    ? (pkg.throttledRpm !== null
                      ? <span style={{display:"inline-flex",alignItems:"center",gap:"4px"}}><InfinityIcon size={18} style={{position:"relative",top:"2px"}}/> → <strong>{pkg.throttledRpm}</strong><small style={{display:"block"}}>rpm</small></span>
                      : <span>Unlimited</span>
                    )
                    : (pkg.baseRpm !== null
                      ? <><strong>{pkg.baseRpm}</strong><small>rpm</small></>
                      : <span>Unlimited</span>
                    )
                  }
                </dd>
              </div>
            </dl>

            {pkg.models && pkg.models.length > 0 && <div className="pkg-models">
              <span className="pkg-models-label">Models</span>
              <div className="model-chips model-chips-mini">
                {pkg.models.slice(0, 5).map(m =>
                  <span className="model-chip" key={`${m.provider}/${m.name}`} title={`${m.provider} · ${m.name}`}>
                    <ProviderMark provider={m.provider} size={16}/>
                    <span>{m.name}</span>
                  </span>)}
                {pkg.models.length > 5 && <button
                  className="models-more" type="button"
                  onClick={() => setModelPopup({ models: pkg.models!, name: plan.displayName })}>
                  +{pkg.models.length - 5} more
                </button>}
              </div>
            </div>}

            <p className="pkg-outcome">
              {unlimited
                ? (pkg.throttledRpm !== null
                  ? <>Fair use: <strong>{formatTokens(Number(pkg.fairUseCap))} tokens</strong> at full speed, then <strong>{pkg.throttledRpm} rpm</strong> — never cut off.</>
                  : <>Truly unlimited — <strong>no fair use cap, no throttle</strong>. Requests never slow down.</>)
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

    <Modal
      open={modelPopup !== null}
      onClose={() => setModelPopup(null)}
      title={modelPopup ? `Models in ${modelPopup.name}` : "Models"}
      subtitle="Every model this package covers."
      footer={<button className="button button-ink compact-button" type="button" onClick={() => setModelPopup(null)}><Check size={15}/> Done</button>}
    >
      {modelPopup && <div className="model-chips" style={{ gap: 7 }}>
        {modelPopup.models.map(m => <span className="model-chip" key={`${m.provider}/${m.name}`}>
          <ProviderMark provider={m.provider} size={16}/>
          <span>{m.name}</span>
        </span>)}
      </div>}
    </Modal>
  </main>;
}
