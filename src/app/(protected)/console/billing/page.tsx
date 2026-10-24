"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import QRCode from "qrcode";
import {
  AlertTriangle, Check, Clock, Coins, Copy, CreditCard,
  Infinity as InfinityIcon, Loader2, Package, ReceiptText, QrCode as QrIcon, RefreshCw, X,
} from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { formatCredits, formatRupiah } from "@/lib/credits";
import { CLERK_ENABLED } from "@/lib/clerk-config";
import { PackageActions } from "@/components/package-actions";
import { ProviderMark } from "@/components/provider-mark";
import { Modal } from "@/components/modal";

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

/* ── Pricing plans (public) ── */
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

type PricingPlan = {
  id: string;
  displayName: string;
  displayDescription: string;
  features: string[];
  priceIdr: number;
  priceCredits: string;
  package: PlanPackage;
};

const formatIdr = (n: number): string => "Rp " + n.toLocaleString("id-ID");
const PLAN_POLL_MS = 4_000;

function QrCanvas({ value, size = 232 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, value, {
      width: size, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    }).catch(() => {});
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} aria-label="QRIS payment code" role="img" />;
}

function useTimeLeft(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (expiresAt === null) { setLeft(null); return; }
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) { setLeft(null); return; }
    const tick = () => setLeft(ms - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return left;
}

function Countdown({ left }: { left: number | null }) {
  if (left === null) return null;
  if (left <= 0) return <span className="topup-expiry topup-expiry-out"><Clock size={13}/> Expired — start a new one.</span>;
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return <span className="topup-expiry"><Clock size={13}/> Expires in {mins}:{String(secs).padStart(2, "0")}</span>;
}

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

/** Plan-purchase order, same shape as the credits page TopupRow. */
type TopupRow = {
  orderId: string;
  status: "pending" | "completed" | "canceled";
  credits: string;
  amountIdr: number;
  feeIdr: number;
  totalIdr: number;
  paymentMethod: string;
  expiresAt: string | null;
  isSandbox: boolean;
  expired: boolean;
  createdAt: string;
  completedAt: string | null;
};

const TOPUP_STATUS: Record<TopupRow["status"], { label: string; tone: string }> = {
  completed: { label: "PAID", tone: "topup-tag-ok" },
  pending: { label: "AWAITING PAYMENT", tone: "topup-tag-wait" },
  canceled: { label: "CANCELED", tone: "topup-tag-off" },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function RefChip({ value }: { value: string }) {
  return <code className="ref-chip" title={`Reference ${value}`}>{value}</code>;
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
                // When collapsed AND there are more than MODELS_SHOWN, show icon-only chips
                // to save space. When collapsed but everything fits (≤ MODELS_SHOWN), show
                // full names — a handful of icons with no names tells the user nothing.
                (allModels || models.length <= MODELS_SHOWN)
                  ? <span className="model-chip" key={`${m.provider}/${m.name}`}>
                      <ProviderMark provider={m.provider} size={16}/>
                      <span>{m.name}</span>
                    </span>
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
  const [freeUsed, setFreeUsed] = useState(0);
  const [freeLimit, setFreeLimit] = useState(20_000_000);
  const [freeResetAt, setFreeResetAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Browse plans: public catalogue + purchase flow (QRIS / credits / free).
  const [pubPlans, setPubPlans] = useState<PricingPlan[]>([]);
  const [pubStatus, setPubStatus] = useState<Status>("loading");
  // QRIS purchase modal state.
  const [qrOpen, setQrOpen] = useState(false);
  const [qrOrder, setQrOrder] = useState<{
    orderId: string;
    qrString: string | null;
    totalIdr: number;
    amountIdr: number;
    feeIdr: number;
    expiresAt: string | null;
    isSandbox: boolean;
  } | null>(null);
  const [qrStatus, setQrStatus] = useState<"pending" | "completed" | "canceled">("pending");
  const [qrError, setQrError] = useState("");
  const [copied, setCopied] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null); // planId being purchased
  const [planError, setPlanError] = useState("");
  const [paymentReady, setPaymentReady] = useState<boolean | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");

  const [invoiceTopups, setInvoiceTopups] = useState<TopupRow[]>([]);
  const [invoiceStatus, setInvoiceStatus] = useState<Status>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token ?? ""}` }, cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as {
        user?: { plan?: string; credits?: unknown; freeTokensUsed?: number; freeTokensLimit?: number; freeTokensResetAt?: string | null };
        subscriptions?: Subscription[];
      };
      setPlan(typeof data.user?.plan === "string" ? data.user.plan : "STANDARD");
      setCredits(typeof data.user?.credits === "string" ? data.user.credits : "0");
      setFreeUsed(typeof data.user?.freeTokensUsed === "number" ? data.user.freeTokensUsed : 0);
      setFreeLimit(typeof data.user?.freeTokensLimit === "number" ? data.user.freeTokensLimit : 20_000_000);
      setFreeResetAt(data.user?.freeTokensResetAt ?? null);
      setSubs(Array.isArray(data.subscriptions) ? data.subscriptions : []);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [getToken]);

  useEffect(() => { if (CLERK_ENABLED) void load(); else setStatus("ready"); }, [load]);

  // Load public pricing plans (no auth needed, but we pass it anyway).
  const loadPlans = useCallback(async () => {
    setPubStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/pricing-plans", { cache: "no-store" });
      if (!res.ok) { setPubStatus("error"); return; }
      const data = await res.json() as { data?: PricingPlan[] };
      setPubPlans(Array.isArray(data.data) ? data.data : []);
      setPubStatus("ready");
    } catch { setPubStatus("error"); }
  }, []);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  // QRIS order polling.
  const qrOrderId = qrOrder?.orderId ?? null;
  const qrOrderStatus = qrStatus;
  const qrExpiresAt = qrOrder?.expiresAt ?? null;

  const qrTimeLeft = useTimeLeft(qrOrder?.expiresAt ?? null);
  const qrPastDeadline = qrTimeLeft !== null && qrTimeLeft <= 0;
  const sandboxRefused = qrError.includes("sandbox mode");
  const qrDead = (qrStatus === "pending" && qrPastDeadline) || sandboxRefused;

  const copyQrString = async () => {
    if (!qrOrder?.qrString) return;
    try {
      await navigator.clipboard.writeText(qrOrder.qrString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setQrError("Clipboard is blocked on this connection — select the text and copy it manually.");
    }
  };

  useEffect(() => {
    if (!qrOpen || qrOrderId === null || qrOrderStatus !== "pending") return;
    let stopped = false;
    let handle: number | undefined;
    const expiryMs = qrExpiresAt === null ? null : new Date(qrExpiresAt).getTime();

    const poll = async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/backend/api/v1/topups/${encodeURIComponent(qrOrderId)}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` }, cache: "no-store",
        });
        if (stopped) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
          if (res.status === 409 && body?.error?.message) {
            setQrError(body.error.message);
            if (handle !== undefined) window.clearInterval(handle);
            stopped = true;
          }
          return;
        }
        const data = await res.json() as { topup?: {
          orderId: string;
          status: "pending" | "completed" | "canceled";
          credits: string;
          amountIdr: number;
          feeIdr: number;
          totalIdr: number;
          paymentMethod: string;
          qrString: string | null;
          vaNumber: string | null;
          expiresAt: string | null;
          isSandbox: boolean;
          expired: boolean;
          createdAt: string;
          completedAt: string | null;
        } };
        if (stopped || !data.topup) return;
        const t = data.topup;
        setQrStatus(t.status);
        setQrOrder(prev => prev ? {
          ...prev,
          qrString: t.qrString ?? prev.qrString,
          totalIdr: t.totalIdr,
          amountIdr: t.amountIdr,
          feeIdr: t.feeIdr,
          expiresAt: t.expiresAt,
          isSandbox: t.isSandbox,
        } : prev);
        if (t.status === "completed") {
          if (handle !== undefined) window.clearInterval(handle);
          stopped = true;
          setQrOpen(false);
          void load();
        }
        if (t.status !== "pending" && handle !== undefined) {
          window.clearInterval(handle);
          stopped = true;
        }
      } catch { /* transient, next tick retries */ }
    };

    handle = window.setInterval(() => {
      if (stopped) return;
      if (expiryMs !== null && Number.isFinite(expiryMs) && Date.now() > expiryMs) {
        window.clearInterval(handle!);
        stopped = true;
        void poll();
        return;
      }
      void poll();
    }, PLAN_POLL_MS);

    return () => {
      stopped = true;
      if (handle !== undefined) window.clearInterval(handle);
    };
  }, [qrOpen, qrOrderId, qrOrderStatus, qrExpiresAt, getToken, load]);

  // Purchase handler: POST /api/v1/pricing-plans/:id/purchase
  const buy = useCallback(async (planId: string, method: "idr" | "credits" | "free") => {
    setPlanError("");
    setPurchasing(planId);
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/pricing-plans/${encodeURIComponent(planId)}/purchase`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" },
        body: JSON.stringify({ paymentMethod: method }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setPlanError(body?.error?.message ?? "Purchase failed.");
        return;
      }
      const data = await res.json() as {
        ok?: boolean;
        method?: string;
        orderId?: string;
        qrString?: string | null;
        totalIdr?: number;
        expiresAt?: string | null;
      };
      if (method === "idr" && data.orderId) {
        setQrOrder({
          orderId: data.orderId,
          qrString: data.qrString ?? null,
          totalIdr: data.totalIdr ?? 0,
          amountIdr: 0,
          feeIdr: 0,
          expiresAt: data.expiresAt ?? null,
          isSandbox: false,
        });
        setQrStatus("pending");
        setQrError("");
        setCopied(false);
        setQrOpen(true);
      } else {
        // credits or free → success → reload
        void load();
      }
    } catch {
      setPlanError("Could not reach the server.");
    } finally {
      setPurchasing(null);
    }
  }, [getToken, load]);

  /** Plan-purchase invoices: DEVORA-PLAN-* orders only (not credit top-ups). */
  const loadInvoices = useCallback(async () => {
    setInvoiceStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/topups", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setInvoiceStatus("error"); return; }
      const data = await res.json() as { topups?: TopupRow[] };
      setInvoiceTopups((Array.isArray(data.topups) ? data.topups : []).filter(t => t.orderId.startsWith("DEVORA-PLAN-")));
      setInvoiceStatus("ready");
    } catch { setInvoiceStatus("error"); }
  }, [getToken]);

  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  // Pre-flight: check that Pakasir is ready before allowing QRIS plan purchases.
  // Fetched once on mount — not polled, because it is a one-time gate, not a live status.
  useEffect(() => {
    let cancelled = false;
    fetch("/backend/api/v1/health/pakasir")
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setPaymentReady(true);
        } else {
          setPaymentReady(false);
          res.json()
            .then((body: { message?: string }) => {
              if (!cancelled) setPaymentMessage(body?.message ?? "The payment gateway is not available.");
            })
            .catch(() => {
              if (!cancelled) setPaymentMessage("The payment gateway is not available.");
            });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPaymentReady(false);
        setPaymentMessage("Could not reach the payment gateway.");
      });
    return () => { cancelled = true; };
  }, []);

  const activeTier = plan ?? "STANDARD";
  const hasSubs = subs.length > 0;
  const freeCapLifted = activeTier !== "STANDARD" || hasSubs;
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
        <div><small>{nextExpiry === null ? "RENEWAL DATE" : "NEXT EXPIRY"}</small><strong>{nextExpiry === null ? "—": stamp(nextExpiry)} <span>{nextExpiry === null ? "no active subscription" : daysLeft(nextExpiry)}</span></strong></div>
      </div>
    </section>

    {/* ---------- free tokens ---------- */}
    <section className="console-section free-tokens-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Free tokens</h2><p>Your lifetime allowance for free and event-covered models — used before credits.</p></div></div>
      </div>
      <div className="free-tokens-card">
        <div className="free-tokens-stats">
          <div>
            <small>USED</small>
            <strong>{formatCounter(freeUsed)}</strong>
          </div>
          <div>
            <small>LIMIT</small>
            <strong>{formatCounter(freeLimit)}</strong>
          </div>
          <div>
            <small>REMAINING</small>
            <strong>{formatCounter(Math.max(0, freeLimit - freeUsed))}</strong>
          </div>
        </div>
        <div className={`free-tokens-bar${freeUsed >= freeLimit ? " exhausted" : ""}`}>
          <i style={{ width: `${Math.min(100, Math.round((freeUsed / freeLimit) * 100))}%` }}/>
        </div>
        <div className="free-tokens-foot">
          {freeCapLifted
            ? <><span className="billing-badge billing-badge-ok">CAP LIFTED</span> Your tier has no free token limit — free and event models are unlimited.</>
            : freeUsed >= freeLimit
              ? <><span className="billing-badge billing-badge-warn">EXHAUSTED</span> Free tokens used up — requests fall through to credits.</>
              : <><span className="billing-badge billing-badge-ok">{Math.round((freeUsed / freeLimit) * 100)}% USED</span> {formatCounter(freeLimit - freeUsed)} tokens remaining</>}
        </div>
        <div className="free-tokens-reset">
          {freeResetAt
            ? <>Last reset: {new Date(freeResetAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
            : <>Never reset — your full allowance is intact.</>}
          <span className="cell-sub"> · Resets are rolled daily across exhausted accounts.</span>
        </div>
      </div>
    </section>

    {/* ---------- subscriptions ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>Active packages</h2><p>The free allowances your account holds. A request uses these before your credits.</p></div></div>
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

    {/* ---------- browse plans ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">03</span><div><h2>Browse plans</h2><p>Purchase a package with IDR (QRIS), credits, or activate a free plan.</p></div></div>
      </div>

      {planError && <p className="voucher-message voucher-error" role="alert"><AlertTriangle size={14}/>{planError}</p>}
      {paymentReady === false && (
        <p className="voucher-message voucher-error"><AlertTriangle size={14}/> Payment is not available right now. {paymentMessage}</p>
      )}

      {pubStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading plans…</strong></div>}
      {pubStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load plans</strong><button type="button" className="button button-outline compact-button" onClick={() => void loadPlans()}>Retry</button></div>}
      {pubStatus === "ready" && pubPlans.length === 0 && <div className="table-empty"><Package size={19}/><strong>No plans available</strong></div>}

      {pubStatus === "ready" && pubPlans.length > 0 && <div className="billing-plans-grid">
        {pubPlans.map((p, i) => {
          const pkg = p.package;
          const unlimited = pkg.category === "unlimited";
          const granted = unlimited ? pkg.fairUseCap : pkg.tokenCap;
          const hasIdr = p.priceIdr > 0;
          const hasCredits = p.priceCredits !== "0" && p.priceCredits !== "";
          const isFree = !hasIdr && !hasCredits;
          const isCurrent = subs.some(s => s.packageId === pkg.id);
          const busy = purchasing === p.id;
          return <article key={p.id} className={`billing-plan-card pkg-card pkg-card-${["mint", "coral", "violet"][i % 3]}`}>
            <div className="pkg-card-top">
              <span className="pkg-icon">{unlimited ? <InfinityIcon size={20}/> : <Package size={20}/>}</span>
              <span className="plan-tag">{pkg.tier}</span>
            </div>
            <h2 className="pkg-name">{p.displayName}</h2>
            {p.displayDescription && <p className="pkg-desc">{p.displayDescription}</p>}

            {p.features.length > 0 && <ul className="pkg-features">
              {p.features.map((f, idx) => <li key={idx}><Check size={13}/> {f}</li>)}
            </ul>}

            <div className="pkg-price">
              {hasIdr && <span className="pkg-price-idr">{formatIdr(p.priceIdr)}</span>}
              {hasIdr && hasCredits && <span className="pkg-price-or">or</span>}
              {hasCredits && <span className="pkg-price-credits">{formatCredits(p.priceCredits)} credits</span>}
              {isFree && <span className="pkg-price-free">Free</span>}
            </div>

            <dl className="pkg-facts">
              <div>
                <dt>{unlimited ? "Fair use" : "Token allowance"}</dt>
                <dd>{granted ? formatCounter(Number(granted)) : "—"}<small>tokens</small></dd>
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

            <div className="billing-plan-actions">
              {isCurrent
                ? <span className="billing-badge billing-badge-ok billing-plan-current">Current</span>
                : <>
                    {hasIdr && <button className="button button-ink compact-button" type="button" disabled={busy || paymentReady === false} onClick={() => void buy(p.id, "idr")}>
                      {busy ? <><Loader2 size={14} className="row-spinner"/> …</> : <><QrIcon size={14}/> Buy with IDR</>}
                    </button>}
                    {hasCredits && <button className="button button-outline compact-button" type="button" disabled={busy} onClick={() => void buy(p.id, "credits")}>
                      {busy ? <><Loader2 size={14} className="row-spinner"/> …</> : <><Coins size={14}/> Buy with credits</>}
                    </button>}
                    {isFree && <button className="button button-ink compact-button" type="button" disabled={busy} onClick={() => void buy(p.id, "free")}>
                      {busy ? <><Loader2 size={14} className="row-spinner"/> …</> : <><Check size={14}/> Activate</>}
                    </button>}
                  </>}
            </div>
          </article>;
        })}
      </div>}
    </section>

    {/* ---------- invoices ---------- */}
    <section className="console-section invoice-section">
      <div className="section-title-row">
        <div><span className="section-index">04</span><div><h2>Invoice history</h2><p>Plan purchases paid over QRIS.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadInvoices()} disabled={invoiceStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr><th>DATE</th><th>ORDER</th><th>STATUS</th><th>AMOUNT</th></tr></thead>
          <tbody>
            {invoiceTopups.length > 0
              ? invoiceTopups.map(t => <tr key={t.orderId}>
                  <td>{formatWhen(t.createdAt)}</td>
                  <td>
                    <RefChip value={t.orderId}/>
                    {t.isSandbox && <small className="cell-sub">test payment</small>}
                  </td>
                  <td className="cell-status">
                    <span className={`topup-tag ${TOPUP_STATUS[t.status].tone}`}>{TOPUP_STATUS[t.status].label}</span>
                    {t.status === "canceled" && t.expired && <small className="cell-sub">code expired</small>}
                  </td>
                  <td className="cell-num">
                    {formatRupiah(t.totalIdr)}
                    {t.feeIdr > 0 && <small className="cell-sub">{formatRupiah(t.amountIdr)} + {formatRupiah(t.feeIdr)} fee</small>}
                  </td>
                </tr>)
              : <tr><td colSpan={4}><div className="table-empty">
                  {invoiceStatus === "loading"
                    ? <><Loader2 size={19} className="row-spinner"/><strong>Loading invoices…</strong></>
                    : invoiceStatus === "error"
                      ? <><X size={19}/><strong>Could not load invoice history</strong></>
                      : <><ReceiptText size={19}/><strong>No invoices yet</strong><p>Plan purchases will appear here.</p></>}
                </div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    {/* ---------- QRIS purchase modal ---------- */}
    <Modal
      open={qrOpen}
      onClose={() => setQrOpen(false)}
      title={qrStatus === "completed" ? "Purchase complete" : "Pay with QRIS"}
      subtitle={qrStatus === "completed" ? "Your plan is now active." : "Scan with any QRIS app — GoPay, OVO, DANA, ShopeePay, or your bank."}
      footer={qrStatus === "completed"
        ? <button className="button button-ink compact-button" type="button" onClick={() => setQrOpen(false)}><Check size={15}/> Done</button>
        : <button className="button button-outline" type="button" onClick={() => setQrOpen(false)}>Close</button>}
    >
      {qrError && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{qrError}</p>}
      {qrStatus === "pending" && qrOrder && <div className="topup-pay">
        {qrDead
          ? <div className="topup-qr topup-qr-dead" aria-hidden>
              <span className="topup-qr-void"><QrIcon size={30}/><small>CODE EXPIRED</small></span>
            </div>
          : <div className="topup-qr">
              {qrOrder.qrString
                ? <QrCanvas value={qrOrder.qrString}/>
                : <div className="table-empty"><QrIcon size={22}/><strong>No QR returned</strong></div>}
            </div>}
        <div className="topup-facts">
          <div className="topup-fact">
            <small>YOU PAY</small>
            <strong>{formatRupiah(qrOrder.totalIdr)}</strong>
          </div>
          {qrOrder.feeIdr > 0 && <div className="topup-fact topup-fact-sub">
            <small>BREAKDOWN</small>
            <strong>{formatRupiah(qrOrder.amountIdr)} + {formatRupiah(qrOrder.feeIdr)} fee</strong>
          </div>}
          {!qrDead && <Countdown left={qrTimeLeft}/>}
        </div>
        {qrDead ? <div className="topup-dead" role="status">
          <Clock size={15}/>
          <div>
            <strong>{sandboxRefused ? "Sandbox payment not credited" : "This code has expired"}</strong>
            <span>
              {sandboxRefused
                ? "The payment went through, but this project is in sandbox mode so no credits were added."
                : "It was not paid in time, so it is canceled and cannot be scanned."}
              {" "}Try again to start a new one.
            </span>
          </div>
        </div> : <div className="topup-status" role="status" aria-live="polite">
          <Loader2 size={14} className="row-spinner"/>
          <span>Waiting for payment… the page checks every few seconds.</span>
        </div>}
        {!qrDead && qrOrder.qrString && <details className="topup-raw">
          <summary>Can&apos;t scan it? Copy the code</summary>
          <div className="topup-raw-row">
            <code>{qrOrder.qrString}</code>
            <button className="button button-outline compact-button" type="button" onClick={() => void copyQrString()}>
              {copied ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}
            </button>
          </div>
        </details>}
        {!qrDead && qrOrder.isSandbox && <div className="modal-danger-note">
          <strong>Sandbox</strong>
          <span>This project is not live yet, so the QR cannot be paid from a real wallet. The plan is still activated so the flow can be tested.</span>
        </div>}
      </div>}
      {qrStatus === "canceled" && <div className="topup-dead" role="status">
        <Clock size={15}/>
        <div>
          <strong>Payment canceled</strong>
          <span>The order was canceled. Try again to start a new one.</span>
        </div>
      </div>}
      {qrStatus === "completed" && <div className="topup-settled">
        <span className="topup-settled-mark"><Check size={26}/></span>
        <div className="topup-settled-copy">
          <strong>Plan activated</strong>
          <small>Your new package is now live.</small>
        </div>
      </div>}
    </Modal>
  </div>;
}
