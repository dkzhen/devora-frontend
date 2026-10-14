"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {ArrowUpRight, Coins, CreditCard, Infinity as InfinityIcon, Loader2, Lock, Package, ReceiptText, X} from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { formatCredits } from "@/lib/credits";
import { CLERK_ENABLED } from "@/lib/clerk-config";
import { PackageActions } from "@/components/package-actions";
import { ProviderMark } from "@/components/provider-mark";

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
  /**
   * The covered models, each with the provider its mark is drawn from. Empty means the package
   * lists none, which covers nothing.
   *
   * Optional because the field is newer than the endpoint's other keys, and a console served
   * against an older backend must degrade rather than crash. Reading `.length` on a response that
   * had not been redeployed is exactly what broke this page once.
   */
  models?: { name: string; provider: string }[];
  /** Live but fully spent — the allowance is gone while the window is still open. */
  exhausted: boolean;
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
function SubscriptionCard({ sub, onChanged }: { sub: Subscription; onChanged: () => void }) {
  // How many model names show before the rest collapse. The card already carries four facts and
  // a bar; a fourteen-name list would swallow it.
  const MODELS_SHOWN = 4;
  const [allModels, setAllModels] = useState(false);
  // One place that guarantees an array, so no branch below has to think about it.
  const models = sub.models ?? [];
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
      {/* A package is a package. The AI sparkle said "this is a model feature", which is the
        wrong noun — the row is a purchased allowance. Unlimited keeps the infinity mark, because
        that one carries information the package glyph cannot. */}
      <span className="billing-sub-icon">{unlimited ? <InfinityIcon size={18}/> : <Package size={18}/>}</span>
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
      {/* "RATE" alone was ambiguous — a rate of what, measured how. It is a requests-per-minute
          ceiling enforced by the gateway, so the label says so. `null` means no ceiling, which is
          a different thing from an allowance that never runs out: one limits pace, the other
          limits total. */}
      <div>
        <small>REQUESTS / MIN</small>
        <strong>{sub.baseRpm === null ? "no limit" : sub.baseRpm}</strong>
      </div>
      <div>
        <small>{sub.expiresAt === null ? "VALID" : "EXPIRES"}</small>
        <strong>{sub.expiresAt === null ? "no expiry" : stamp(sub.expiresAt)}</strong>
      </div>
    </div>

    {pct !== null && <div className="billing-sub-bar"><i style={{ width: `${pct}%` }}/></div>}

    {/* What the allowance actually covers. A count alone leaves the customer holding a package
        and still unable to tell whether the model they want is inside it. */}
    <div className={`billing-sub-models${allModels ? " billing-sub-models-expanded" : ""}`}>
      <span className="billing-sub-models-label">Models</span>
      {models.length === 0
        ? <p className="billing-sub-models-none">No models listed — this package covers nothing.</p>
        : <>
            <div className={`model-chips${allModels ? "" : " model-chips-mini"}`}>
              {(allModels ? models : models.slice(0, MODELS_SHOWN)).map(m =>
                allModels
                  ? <span className="model-chip" key={`${m.provider}/${m.name}`}>
                      <ProviderMark provider={m.provider} size={16}/>
                      <span>{m.name}</span>
                    </span>
                  // Collapsed: the mark alone, named on hover. Counting is not the job here —
                  // recognising a provider is, and a logo does that faster than a word.
                  : <span className="model-chip-mini" key={`${m.provider}/${m.name}`} title={m.name}>
                      <ProviderMark provider={m.provider} size={18}/>
                    </span>)}
              {/* Inside the row: the control belongs to the stack, so sitting at the end of it
                  reads as "and the rest" rather than as a separate line item below. */}
              {models.length > MODELS_SHOWN && <button
                className="models-more" type="button" onClick={() => setAllModels(v => !v)}>
                {allModels ? "Show fewer" : `+${models.length - MODELS_SHOWN} more`}
              </button>}
            </div>
          </>}
    </div>

    <div className="billing-sub-foot">
      <span className="billing-sub-state">
        {unlimited
          ? (throttled
            ? <><span className="billing-badge billing-badge-warn">THROTTLED {sub.throttledRpm ?? ""} RPM</span> past fair use — still serving</>
            : <><span className="billing-badge billing-badge-ok">UNLIMITED</span> tokens, {sub.baseRpm === null ? "no request ceiling" : `${sub.baseRpm} requests/min`}</>)
          : (exhausted
            ? <><span className="billing-badge billing-badge-warn">EXHAUSTED</span> allowance spent — top it up, or fall back to credits</>
            : <><span className="billing-badge billing-badge-ok">HARD CAP</span> ends at the allowance</>)}
      </span>
      <span className="billing-sub-days">{daysLeft(sub.expiresAt)}</span>
    </div>

    <PackageActions sub={sub} onChanged={onChanged}/>
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
        {subs.map(s => <SubscriptionCard key={s.id} sub={s} onChanged={() => void load()}/>)}
      </div>}
    </section>

    {/* ---------- invoices ---------- */}
    <section className="console-section invoice-section">
      <div className="section-title-row"><div><span className="section-index">02</span><div><h2>Invoice history</h2><p>Your billing history will appear here.</p></div></div></div>
      <div className="invoice-empty"><span className="invoice-empty-icon"><ReceiptText size={19}/></span><strong>No invoices yet</strong><p>Once card payment is enabled, invoices will show up in this list.</p></div>
    </section>
  </div>;
}
