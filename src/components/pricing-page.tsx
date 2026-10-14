"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Gift, Infinity as InfinityIcon, Loader2, Package, Sparkles, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { formatTokens } from "@/lib/tokens";

/**
 * A package as the pricing page shows it. `hard_cap` = a token ceiling; `unlimited` = an open
 * allowance that throttles past a fair-use threshold. Both are granted by redeeming a voucher
 * the operator issues — there is no self-serve checkout yet, so the page's call to action is to
 * get an API key / ask for a package, not a payment button.
 */
type Pkg = {
  id: string;
  name: string;
  description: string;
  category: "hard_cap" | "unlimited";
  tier: string;
  durationDays: number | null;
  tokenCap: string | null;
  fairUseCap: string | null;
  baseRpm: number | null;
  throttledRpm: number | null;
};

export function PricingPage() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/packages", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { data?: Pkg[] };
      setPackages(Array.isArray(data.data) ? data.data : []);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <main className="landing events-landing">
    <nav className="landing-nav">
      <Brand/>
      <div className="landing-links"><Link href="/#why">Why Devora</Link><Link href="/models">Models</Link><Link href="/events">Events</Link></div>
      <PrimaryLink href="/console/billing">Open console</PrimaryLink>
    </nav>

    <section className="mp-head">
      <div className="section-tag"><Package size={13}/> PRICING</div>
      <h1>Pricing</h1>
      <p>Subscription packages bundle an allowance — a token ceiling, or an open plan that slows past fair use. Redeem a voucher to activate one.</p>
    </section>

    <section className="mp-body">
      {status === "loading" && <div className="land-pricing-state"><Loader2 size={20} className="row-spinner"/><strong>Loading plans…</strong></div>}
      {status === "error" && <div className="land-pricing-state"><Zap size={20}/><strong>Could not load plans</strong><button className="button button-outline compact-button" type="button" onClick={() => void load()}>Try again</button></div>}
      {status === "ready" && packages.length === 0 && <div className="land-pricing-state">
        <Gift size={20}/><strong>No public plans yet</strong>
        <p>Everything in the catalogue is still available from your console on pay-as-you-go credits.</p>
      </div>}

      {status === "ready" && packages.length > 0 && <div className="pkg-grid">
        {packages.map((p, i) => {
          const unlimited = p.category === "unlimited";
          const granted = unlimited ? p.fairUseCap : p.tokenCap;
          return <article key={p.id} className={`pkg-card pkg-card-${["mint", "coral", "violet"][i % 3]}`}>
            <div className="pkg-card-top">
              <span className="pkg-icon">{unlimited ? <InfinityIcon size={20}/> : <Sparkles size={20}/>}</span>
              <span className="plan-tag">{p.tier}</span>
            </div>
            <h2 className="pkg-name">{p.name}</h2>
            {p.description && <p className="pkg-desc">{p.description}</p>}

            <dl className="pkg-facts">
              <div>
                <dt>{unlimited ? "Fair use" : "Token allowance"}</dt>
                <dd>{granted ? formatTokens(Number(granted)) : "—"}<small>tokens</small></dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{p.durationDays === null ? "Lifetime" : `${p.durationDays}`}<small>{p.durationDays === null ? "" : "days"}</small></dd>
              </div>
              <div>
                <dt>Request rate</dt>
                <dd>{p.baseRpm === null ? "Unlimited" : `${p.baseRpm}`}<small>rpm</small></dd>
              </div>
            </dl>

            {/* What happens when the allowance runs out — the difference between the two kinds,
                stated where the buyer decides. */}
            <p className="pkg-outcome">
              {unlimited
                ? <>Past fair use, requests continue at <strong>{p.throttledRpm ?? "a reduced"} rpm</strong> — never cut off.</>
                : <>Once the allowance is spent, the plan ends and your account falls back to <strong>pay-as-you-go credits</strong>.</>}
            </p>

            <div className="pkg-card-foot">
              <PrimaryLink href="/auth?next=%2Fconsole%2Fvouchers">Redeem a code <ArrowRight size={14}/></PrimaryLink>
            </div>
          </article>;
        })}
      </div>}

      <div className="pkg-note">
        <Check size={15}/> Every plan grants the same models the SUBSCRIPTION tier can reach; pay-as-you-go credits and running events work alongside it.
      </div>
    </section>

    <footer className="landing-footer">
      <Brand/>
      <p>One platform. More ways to build.</p>
      <span className="landing-footer-copy">© 2026 Devora</span>
    </footer>
  </main>;
}
