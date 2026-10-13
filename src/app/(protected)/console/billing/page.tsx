"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ArrowUpRight, Coins, CreditCard, Infinity as InfinityIcon, Loader2, Lock, ReceiptText, Sparkles, WalletCards, X } from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { formatCredits } from "@/lib/credits";
import { CLERK_ENABLED } from "@/lib/clerk-config";

/**
 * A live subscription, as /api/v1/users/me reports it. Shape mirrors the backend's mapping.
 */
type Subscription = {
  id: string;
  packageId: string;
  name: string;
  category: "hard_cap" | "unlimited";
  tier: string;
  startedAt: string;
  expiresAt: string | null;
  tokensUsed: string;
  tokenCap: string | null;
  fairUseCap: string | null;
  baseRpm: number | null;
  throttledRpm: number | null;
  modelCount: number;
};

type Status = "loading" | "ready" | "error";

const stamp = (iso: string | null): string => {
  if (iso === null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

function daysLeft(iso: string | null): string {
  if (iso === null) return "no expiry";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  const d = Math.ceil(ms / 86_400_000);
  if (d <= 0) return "expired";
  return d === 1 ? "1 day left" : `${d} days left`;
}

/**
 * One live package. Two of these can be held at once (a hard cap and an unlimited plan, or two
 * different packages), so this is a list item, not a single hero — the page shows every
 * subscription the account holds rather than assuming one.
 */
function SubscriptionCard({ sub }: { sub: Subscription }) {
  const unlimited = sub.category === "unlimited";
  const granted = unlimited ? sub.fairUseCap : sub.tokenCap;
  const used = Number(sub.tokensUsed);
  const cap = granted ? Number(granted) : null;
  const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null;
  // Unlimited never fills; "over" means past fair use, where the rate drops.
  const throttled = unlimited && cap !== null && used >= cap;
  const exhausted = !unlimited && cap !== null && used >= cap;

  return <article className={`billing-sub${throttled || exhausted ? " billing-sub-capped" : ""}`}>
    <div className="billing-sub-head">
      <span className="billing-sub-icon">{unlimited ? <InfinityIcon size={18}/> : <Sparkles size={18}/>}</span>
      <div className="billing-sub-title">
        <strong>{sub.name}</strong>
        <small>
          <code>{sub.packageId}</code> · {sub.modelCount} {sub.modelCount === 1 ? "model" : "models"} covered
        </small>
      </div>
      <span className="plan-tag">{sub.tier}</span>
    </div>

    <div className="billing-sub-facts">
      <div>
        <small>{unlimited ? "FAIR USE" : "ALLOWANCE"}</small>
        <strong>{cap === null ? "—" : formatCounter(cap)}</strong>
      </div>
      <div>
        <small>USED</small>
        <strong>{formatCounter(used)}</strong>
      </div>
      <div>
        <small>RATE</small>
        <strong>{sub.baseRpm === null ? "unlimited" : `${sub.baseRpm} rpm`}</strong>
      </div>
      <div>
        <small>{sub.expiresAt === null ? "VALID" : "EXPIRES"}</small>
        <strong>{sub.expiresAt === null ? "no expiry" : stamp(sub.expiresAt)}</strong>
      </div>
    </div>

    {pct !== null && <div className="billing-sub-bar"><i style={{ width: `${pct}%` }}/></div>}

    <div className="billing-sub-foot">
      <span className="billing-sub-state">
        {unlimited
          ? (throttled
            ? <><span className="billing-badge billing-badge-warn">THROTTLED {sub.throttledRpm ?? ""} RPM</span> past fair use — still serving</>
            : <><span className="billing-badge billing-badge-ok">UNLIMITED</span> requests, {sub.baseRpm === null ? "no rate limit" : `${sub.baseRpm} rpm`}</>)
          : (exhausted
            ? <><span className="billing-badge billing-badge-warn">EXHAUSTED</span> allowance spent — falls back to credits</>
            : <><span className="billing-badge billing-badge-ok">HARD CAP</span> ends at the allowance</>)}
      </span>
      <span className="billing-sub-days">{daysLeft(sub.expiresAt)}</span>
    </div>
  </article>;
}

export default function BillingPage() {
  const { getToken } = useAuth();
  const [plan, setPlan] = useState<string | null>(null);
  const [credits, setCredits] = useState("0");
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token ?? ""}` }, cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as {
        user?: { plan?: string; credits?: unknown };
        subscriptions?: Subscription[];
      };
      setPlan(typeof data.user?.plan === "string" ? data.user.plan : "STANDARD");
      setCredits(typeof data.user?.credits === "string" ? data.user.credits : "0");
      setSubs(Array.isArray(data.subscriptions) ? data.subscriptions : []);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [getToken]);

  useEffect(() => { if (CLERK_ENABLED) void load(); else setStatus("ready"); }, [load]);

  const activeTier = plan ?? "STANDARD";
  const hasSubs = subs.length > 0;
  // The soonest expiry across every live subscription is what the account should plan around.
  const nextExpiry = subs
    .map(s => s.expiresAt)
    .filter((e): e is string => e !== null)
    .sort()[0] ?? null;

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><CreditCard size={14}/> MAIN / BILLING</div><h1>Billing</h1><p>Your plan, the allowances it grants, and what is left of them.</p></div></div>

    {/* ---------- current plan ---------- */}
    <section className="console-section billing-plan">
      <div className="billing-plan-top">
        <div>
          <span className="section-tag">CURRENT PLAN</span>
          <h2>{activeTier}</h2>
          <p>{hasSubs
            ? `On ${subs.length} active ${subs.length === 1 ? "package" : "packages"}, plus pay-as-you-go credits.`
            : "Pay-as-you-go. Every model is billed from your credits; a package would add a free allowance on top."}</p>
        </div>
        <div className="plan-decoration"><WalletCards size={32}/></div>
      </div>
      <div className="plan-details">
        <div><small>CREDITS</small><strong>{formatCredits(credits)} <span>pay-as-you-go</span></strong></div>
        <div><small>ACTIVE PACKAGES</small><strong>{subs.length} <span>{hasSubs ? "see below" : "none yet"}</span></strong></div>
        <div><small>{nextExpiry === null ? "RENEWAL DATE" : "NEXT EXPIRY"}</small><strong>{nextExpiry === null ? "—" : stamp(nextExpiry)} <span>{nextExpiry === null ? "no active subscription" : daysLeft(nextExpiry)}</span></strong></div>
        <button className="button button-ink" type="button" disabled aria-disabled="true" title="Purchase is not available in the console yet"><Lock size={15}/> Change plan <ArrowUpRight size={16}/></button>
      </div>
    </section>

    {/* ---------- subscriptions ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Active packages</h2><p>The free allowances your account holds. A request uses these before your credits.</p></div></div>
      </div>

      {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading your plan…</strong></div>}
      {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load your plan</strong><button type="button" className="button button-outline compact-button" onClick={() => void load()}>Retry</button></div>}
      {status === "ready" && !hasSubs && <div className="table-empty">
        <Coins size={19}/><strong>No active package</strong>
        <p>You are on pay-as-you-go credits. Redeem a voucher to activate a package.</p>
      </div>}
      {status === "ready" && hasSubs && <div className="billing-subs">
        {subs.map(s => <SubscriptionCard key={s.id} sub={s}/>)}
      </div>}
    </section>

    {/* ---------- invoices ---------- */}
    <section className="console-section invoice-section">
      <div className="section-title-row"><div><span className="section-index">02</span><div><h2>Invoice history</h2><p>Your billing history will appear here.</p></div></div></div>
      <div className="invoice-empty"><span className="invoice-empty-icon"><ReceiptText size={19}/></span><strong>No invoices yet</strong><p>Once card payment is enabled, invoices will show up in this list.</p></div>
    </section>
  </div>;
}
