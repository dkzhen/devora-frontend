"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import {
  AlertTriangle, ArrowUpRight, Check, ChevronLeft, ChevronRight, Clock, Coins, Copy, CreditCard, Download, ExternalLink,
  Infinity as InfinityIcon, Info, Loader2, Package, ReceiptText, QrCode as QrIcon, RefreshCw, Share2, ShieldCheck, X,
} from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { formatTokens } from "@/lib/tokens";
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
  models?: { name: string; provider: string }[];
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

/** Payment method as returned by /api/v1/payment/methods */
type PaymentMethodItem = {
  id: string;
  name: string;
  gateway: string;
  category: "credits" | "idr" | "usd";
  currency: string;
  description: string | null;
  icon: string | null;
  isActive: boolean;
  visibility?: "active" | "inactive" | "private";
};

/** Public pricing plan — same as PlanPackage but used in the popup */
type PubPlan = {
  id: string;
  displayName: string;
  priceIdr: number;
  priceCredits: string;
  package: PlanPackage;
};

/** Plan-purchase order, same shape as the credits page TopupRow. */
type TopupRow = {
  orderId: string;
  status: "pending" | "completed" | "canceled";
  credits: string;
  amountIdr: number;
  feeIdr: number;
  totalIdr: number;
  paymentMethod: string;
  qrString: string | null;
  expiresAt: string | null;
  isSandbox: boolean;
  gateway: string | null;
  expired: boolean;
  createdAt: string;
  completedAt: string | null;
};

type InvoiceResult = { data: TopupRow[]; total: number; totalPages: number; page: number };
type Pagination = { page: number; limit: number; total: number; totalPages: number };

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
 * Page window for pagination controls.
 * Shows up to 5 consecutive pages around the current page, with leading 1 and trailing total
 * when there is a gap. Total pages <= 5: show all, no gaps.
 */
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);

  // Show first + window of 3 + last = max 5 numbers visible.
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, Math.min(current - 1, total - 3));
  const to = Math.min(total - 1, from + 2);

  if (from > 2) out.push("gap");
  for (let n = from; n <= to; n++) out.push(n);
  if (to < total - 1) out.push("gap");
  out.push(total);

  return out;
}

/**
 * Share card — Devora themed (cream/paper/mint), exportable as PNG.
 * Promo: shows package value (tokens/credits) vs what pay-as-you-go would cost.
 */
function PackageShareCard({ sub, unlimited, used, cap, pct, throttled, exhausted, models, priceIdr }: {
  sub: Subscription; unlimited: boolean; used: number; cap: number | null; pct: number | null; throttled: boolean; exhausted: boolean; models: { provider: string; name: string }[]; priceIdr: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const remaining = cap !== null ? cap - used : 0;
  const totalGranted = cap ?? 0;
  const paygoCreditsEquivalent = totalGranted; // 1 token = 1 credit in pay-as-you-go
  const expiryText = sub.expiresAt ? stamp(sub.expiresAt) : "no expiry";
  const daysLeftText = sub.expiresAt ? daysLeft(sub.expiresAt) : "";
  const modelsShown = models.slice(0, 6);
  const modelsOverflow = models.length - modelsShown.length;

  const download = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(cardRef.current, { quality: 0.95, pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `devora-${sub.packageId}.png`;
      link.href = dataUrl;
      link.click();
    } catch { /* ignore */ }
    finally { setDownloading(false); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* The card */}
      <div ref={cardRef} style={{
        background: "var(--paper)",
        border: "2px solid var(--ink)",
        boxShadow: "4px 4px 0 var(--ink)",
        padding: 0,
        overflow: "hidden",
        maxWidth: 560,
        width: "100%",
        fontFamily: "var(--body)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1.5px solid var(--line)",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{
              width: 34, height: 34, display: "grid", placeItems: "center",
              border: "2px solid var(--ink)", background: "var(--mint)",
              boxShadow: "2px 2px 0 var(--ink)", transform: "rotate(-4deg)",
            }}>
              <Package size={18}/>
            </div>
            <div>
              <strong style={{fontFamily:"var(--display)",fontSize:"var(--fs-subhead)",letterSpacing:"-0.3px",display:"block"}}>Devora AI</strong>
              <small style={{fontSize:"var(--fs-micro)",color:"var(--muted)",letterSpacing:"0.5px"}}>{sub.name}</small>
            </div>
          </div>
          <span style={{
            fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "1px",
            color: exhausted || throttled ? "#fff" : "var(--ink)",
            background: exhausted || throttled ? "var(--coral)" : "var(--mint)",
            border: `1.5px solid var(--ink)`,
            padding: "4px 10px",
          }}>
            {exhausted ? "EXHAUSTED" : throttled ? "THROTTLED" : "ACTIVE"}
          </span>
        </div>

        {/* Big numbers row — tokens used + price */}
        <div style={{display:"flex",padding:"20px 20px 16px",gap:0}}>
          <div style={{flex:"0 0 55%",borderRight:"1.5px solid var(--line)"}}>
            <small style={{fontSize:"var(--fs-micro)",letterSpacing:"1px",color:"var(--muted)",fontWeight:700,display:"block",marginBottom:6}}>
              {unlimited ? "FAIR USE USED" : "TOKENS USED"}
            </small>
            <strong style={{fontFamily:"var(--display)",fontSize:36,lineHeight:1,letterSpacing:"-1.5px",color:"var(--ink)"}}>
              {formatCounter(used)}
            </strong>
            <div style={{fontSize:"var(--fs-small)",color:"var(--muted)",marginTop:4}}>
              / {unlimited && !throttled ? "∞" : formatCounter(totalGranted)} {unlimited ? "fair use cap" : "token cap"}
            </div>
            {pct !== null && pct > 0 && (
              <div style={{marginTop:8,height:4,background:"#eae4d8",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background: exhausted || throttled ? "var(--coral)" : "var(--mint)"}} />
              </div>
            )}
          </div>
          <div style={{flex:"0 0 45%",paddingLeft:20,display:"flex",flexDirection:"column",justifyContent:"center",gap:10}}>
            <div>
              <small style={{fontSize:"var(--fs-micro)",letterSpacing:"0.7px",color:"var(--muted)",fontWeight:700,display:"block",marginBottom:3}}>PACKAGE PRICE</small>
              <strong style={{fontFamily:"var(--display)",fontSize:"var(--fs-h4)",color:"var(--ink)"}}>
                {priceIdr > 0 ? formatIdr(priceIdr) : "Free"}
              </strong>
            </div>
            <div>
              <small style={{fontSize:"var(--fs-micro)",letterSpacing:"0.7px",color:"var(--muted)",fontWeight:700,display:"block",marginBottom:3}}>PAY-AS-YOU-GO EQ.</small>
              <strong style={{fontFamily:"var(--display)",fontSize:"var(--fs-small)",color:"var(--coral)",textDecoration:"line-through"}}>
                {priceIdr > 0 ? formatIdr(totalGranted) : `${formatCounter(paygoCreditsEquivalent)} credits`}
              </strong>
              <div style={{fontSize:"var(--fs-micro)",color:"var(--mint)",fontWeight:600,marginTop:2}}>
                {priceIdr > 0 && totalGranted > 0
                  ? `Save ${Math.round((1 - priceIdr / totalGranted) * 100)}% vs pay-as-you-go`
                  : "Package saves credits on every request"}
              </div>
            </div>
          </div>
        </div>

        {/* Models covered */}
        {modelsShown.length > 0 && (
          <div style={{padding:"0 20px 16px"}}>
            <small style={{fontSize:"var(--fs-micro)",letterSpacing:"0.7px",color:"var(--muted)",fontWeight:700,display:"block",marginBottom:8}}>MODELS COVERED ({sub.modelCount})</small>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {modelsShown.map(m => (
                <span key={`${m.provider}/${m.name}`} style={{
                  display:"inline-flex",alignItems:"center",gap:5,
                  fontSize:"var(--fs-micro)", fontWeight:600,
                  padding:"3px 8px", border:"1px solid var(--line)",
                  background:"var(--cream)", color:"var(--ink)",
                }}>
                  <ProviderMark provider={m.provider} size={14}/>
                  {m.name}
                </span>
              ))}
              {modelsOverflow > 0 && (
                <span style={{fontSize:"var(--fs-micro)",fontWeight:600,padding:"3px 8px",color:"var(--muted)"}}>
                  +{modelsOverflow} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px",
          borderTop: "1px solid var(--line)",
          background: "var(--cream)",
        }}>
          <code style={{fontSize:"var(--fs-micro)",color:"var(--muted)",fontFamily:"var(--font-code)"}}>
            {sub.packageId}
          </code>
          <span style={{fontSize:"var(--fs-micro)",color: daysLeftText.includes("HOUR") || daysLeftText.includes("DAY LEFT") ? "var(--coral)" : "var(--muted)",fontWeight:600}}>
            {daysLeftText || expiryText}
          </span>
        </div>
      </div>

      {/* Download button */}
      <div style={{display:"flex",justifyContent:"center"}}>
        <button className="button button-ink" type="button" onClick={() => void download()} disabled={downloading} style={{minHeight:48,padding:"0 32px"}}>
          {downloading
            ? <><Loader2 size={16} className="row-spinner"/> Exporting…</>
            : <><Download size={18}/> Download PNG</>}
        </button>
      </div>
    </div>
  );
}

/**
 * One live package. Two of these can be held at once (a hard cap and an unlimited plan, or two
 * different packages), so this is a list item, not a single hero — the page shows every
 * subscription the account holds rather than assuming one.
 */
function SubscriptionCard({ sub, onChanged, priceIdr }: { sub: Subscription; onChanged: () => void; priceIdr: number }) {
  const MODELS_SHOWN = 4;
  const [allModels, setAllModels] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
      <button className="billing-sub-share" type="button" title="Package details" onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}>
        <ExternalLink size={16}/>
      </button>
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
        <strong>{sub.baseRpm === null && sub.throttledRpm === null
          ? <InfinityIcon size={20} style={{position:"relative",top:"3px"}}/>
          : throttled && sub.throttledRpm !== null
            ? sub.throttledRpm
            : sub.baseRpm ?? <InfinityIcon size={20} style={{position:"relative",top:"3px"}}/>}
        </strong>
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
      <span className="billing-sub-days" style={{alignSelf:"flex-end"}}>{daysLeft(sub.expiresAt)}</span>
      <span className={`billing-sub-status ${exhausted || throttled ? "is-danger" : "is-ok"}`}>
        {exhausted
          ? <><AlertTriangle size={14}/> Token allowance exhausted. Remove this package to buy again, or purchase a different package.</>
          : throttled
            ? <><AlertTriangle size={14}/> Unlimited tokens — rate limit now {sub.throttledRpm ?? ""} RPM</>
            : <><ShieldCheck size={14}/> {unlimited ? "Package active — unlimited tokens, full speed" : `Package active — ${formatCounter(cap !== null ? cap - used : 0)} tokens remaining`}</>}
      </span>
    </div>

    {shareOpen && (
      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share package"
        subtitle={sub.name}
        footer={<button className="button button-outline compact-button" type="button" onClick={() => setShareOpen(false)}>Close</button>}
      >
        <PackageShareCard sub={sub} unlimited={unlimited} used={used} cap={cap} pct={pct} throttled={throttled} exhausted={exhausted} models={models} priceIdr={priceIdr} />
      </Modal>
    )}

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
  const [modelPopup, setModelPopup] = useState<{ models: { name: string; provider: string }[]; name: string } | null>(null);
  const [cancelReason, setCancelReason] = useState<{ orderId: string; reason: string } | null>(null);
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

  // Payment method popup state
  const [paymentPopup, setPaymentPopup] = useState<{ plan: PubPlan; methods: PaymentMethodItem[]; rates: { idrToCredits: number } | null } | null>(null);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [paymentPopupBusy, setPaymentPopupBusy] = useState(false);
  const [paymentPopupError, setPaymentPopupError] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState("");

  const [invoiceResult, setInvoiceResult] = useState<InvoiceResult | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<Status>("loading");
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);

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

  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const openPaymentPopup = async (plan: PubPlan) => {
    setPaymentPopupError("");
    setPaymentMethodsLoading(true);
    setSelectedMethodId("");
    setPaymentPopup({ plan, methods: [], rates: null });
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/payment/methods", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setPaymentPopupError("Could not load payment methods."); return; }
      const data = await res.json() as { methods?: PaymentMethodItem[]; rates?: { idrToCredits: number } };
      const all = data.methods ?? [];
      // Filter methods based on what the plan accepts
      const hasIdr = plan.priceIdr > 0;
      const hasCredits = plan.priceCredits !== "0" && plan.priceCredits !== "";
      const filtered = hasIdr && hasCredits
        ? all // both — show all
        : hasIdr
          ? all.filter(m => m.category === "idr" || m.category === "usd") // IDR only — no credits
          : hasCredits
            ? all.filter(m => m.category === "credits") // Credits only
            : all; // free — shouldn't reach here
      setPaymentPopup({ plan, methods: filtered, rates: data.rates ?? null });
    } catch {
      setPaymentPopupError("Could not reach the server.");
    } finally {
      setPaymentMethodsLoading(false);
    }
  };

  /** Confirm payment with selected method — calls new /api/v1/payment/orders. */
  const confirmPayment = async () => {
    if (!paymentPopup || !selectedMethodId) return;
    setPaymentPopupBusy(true);
    setPaymentPopupError("");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/payment/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" },
        body: JSON.stringify({ paymentMethodId: selectedMethodId, planId: paymentPopup.plan.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setPaymentPopupError(body?.error?.message ?? "Payment failed.");
        return;
      }
      const data = await res.json() as {
        status: string;
        qrString?: string | null;
        orderId?: string;
        topupOrderId?: string;
        expiresAt?: string | null;
        totalIdr?: number;
      };
      if (data.status === "completed") {
        setPaymentPopup(null);
        setPaymentSuccess(true);
        void load();
      } else if (data.qrString) {
        // Show QR — reuse existing QR modal
        setQrOrder({
          orderId: data.topupOrderId ?? data.orderId ?? "",
          qrString: data.qrString,
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
        setPaymentPopup(null);
      } else {
        setPaymentPopupError("Unexpected response from server.");
      }
    } catch {
      setPaymentPopupError("Could not reach the server.");
    } finally {
      setPaymentPopupBusy(false);
    }
  };

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

  // Single fetch effect for invoices — AbortController ensures only the latest wins.
  // invoiceResult is committed atomically: data + total + page always come from the same response.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setInvoiceStatus("loading");
      const params = new URLSearchParams({ page: String(invoicePage), limit: "10" });

      try {
        const token = await getToken();
        const res = await fetch(`/backend/api/v1/invoices?${params}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) setInvoiceStatus("error");
          return;
        }
        const data = await res.json() as { invoices?: TopupRow[]; pagination?: Pagination };
        if (!controller.signal.aborted) {
          setInvoiceResult({
            data: data.invoices ?? [],
            total: data.pagination?.total ?? 0,
            totalPages: data.pagination?.totalPages ?? 1,
            page: data.pagination?.page ?? invoicePage,
          });
          setInvoiceStatus("ready");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) setInvoiceStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [invoicePage, getToken, invoiceRefreshKey]);

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
  const ringPct = freeCapLifted ? 0 : Math.min(327, Math.round((freeUsed / freeLimit) * 327));
  // The soonest expiry across every live subscription is what the account should plan around.
  const nextExpiry = subs
    .map(s => s.expiresAt)
    .filter((e): e is string => e !== null)
    .sort()[0] ?? null;

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><CreditCard size={14}/> MAIN / BILLING</div><h1>Billing</h1><p>Your plan, the allowances it grants, and what is left of them.</p></div></div>

    {/* ---------- current plan ---------- */}
    <section className="console-section">
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
        <div>
          <small>CREDITS</small>
          <strong>{formatCredits(credits)} <span>pay-as-you-go</span></strong>
        </div>
        <div>
          <small>ACTIVE PACKAGES</small>
          <strong>{subs.length} <span>{hasSubs ? "see below" : "none yet"}</span></strong>
        </div>
        <div>
          <small>{nextExpiry === null ? "RENEWAL DATE" : "NEXT EXPIRY"}</small>
          <strong>{nextExpiry === null ? "—" : stamp(nextExpiry)} <span>{nextExpiry === null ? "no active subscription" : daysLeft(nextExpiry)}</span></strong>
        </div>
      </div>
    </section>

    {/* ---------- free tokens ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Free tokens</h2><p>Your lifetime allowance for free and event-covered models — used before credits.</p></div></div>
      </div>

      <div className="overview-divider" />

      {/* Percentage display — large number, small label, centered */}
      <div className="allowance-percent">
        <strong>{freeCapLifted ? "∞" : `${Math.round((freeUsed / freeLimit) * 100)}`}<small>{freeCapLifted ? "" : "%"}</small></strong>
        <span>used</span>
      </div>

      <div className="overview-divider" />

      {/* 3 columns: USED / LIMIT / REMAINING */}
      <div className="overview-stats">
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

      <div className="overview-divider" />

      <div className={`allowance-status-card${freeCapLifted ? " status-ok" : freeUsed >= freeLimit ? " status-warn" : " status-ok"}`}>
        <div className="allowance-status-body">
          <div className="allowance-status-title">
            {freeCapLifted ? <ArrowUpRight size={14}/> : freeUsed >= freeLimit ? <AlertTriangle size={14}/> : <Info size={14}/>}
            <strong>{freeCapLifted ? "CAP LIFTED" : freeUsed >= freeLimit ? "EXHAUSTED" : `${Math.round((freeUsed / freeLimit) * 100)}% USED`}</strong>
          </div>
          <span>{freeCapLifted
            ? "Your tier has no free token limit — free and event models are unlimited."
            : freeUsed >= freeLimit
              ? "Free tokens used up — requests fall through to credits."
              : `${formatCounter(freeLimit - freeUsed)} tokens remaining`}</span>
        </div>
      </div>

      <div className="free-tokens-reset">
        {freeResetAt
          ? <>Last reset: {new Date(freeResetAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
          : <>Never reset — your full allowance is intact.</>}
        <span className="cell-sub"> · Resets are rolled daily across exhausted accounts.</span>
      </div>
    </section>

    {/* ---------- payment success modal (for instant/credits payment) ---------- */}
    {paymentSuccess && (
      <Modal
        open={paymentSuccess}
        onClose={() => setPaymentSuccess(false)}
        title="Purchase complete"
        subtitle="Your plan is now active."
        footer={<button className="button button-ink compact-button" type="button" onClick={() => setPaymentSuccess(false)}><Check size={15}/> Done</button>}
      >
        <div className="topup-settled">
          <span className="topup-settled-mark"><Check size={26}/></span>
          <div className="topup-settled-copy">
            <strong>Plan activated</strong>
            <small>Your new package is now live.</small>
          </div>
        </div>
      </Modal>
    )}

    {/* ---------- subscriptions ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>Active packages</h2><p>Your active subscription packages.</p></div></div>
      </div>

      {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading your plan…</strong></div>}
      {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load your plan</strong><button type="button" className="button button-outline compact-button" onClick={() => void load()}>Retry</button></div>}
      {status === "ready" && !hasSubs && <div className="table-empty">
        <Coins size={19}/><strong>No active package</strong>
        <p>You are on pay-as-you-go credits. Redeem a voucher to activate a package.</p>
      </div>}
      {status === "ready" && hasSubs && <>
        <div className="billing-sub-notice"><AlertTriangle size={14} /> Each package can only be active once at a time. To buy the same package again, remove the active one first. You can hold multiple different packages simultaneously.</div>
        <div className="billing-subs">
          {subs.map(s => {
            const matchingPlan = pubPlans.find(p => p.package?.id === s.packageId || p.id === s.packageId);
            return <SubscriptionCard key={s.id} sub={s} onChanged={() => void load()} priceIdr={matchingPlan?.priceIdr ?? 0} />;
          })}
        </div>
      </>}
    </section>

    {/* ---------- browse plans ---------- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">03</span><div><h2>Browse plans</h2><p>Purchase a package with IDR (QRIS), credits, or activate a free plan.</p></div></div>
      </div>

      {planError && <p className="voucher-message voucher-error" role="alert"><AlertTriangle size={14}/>{planError}</p>}

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
              {hasIdr && <div><span className="pkg-price-idr">{p.priceIdr.toLocaleString("id-ID")}</span></div>}
              {!hasIdr && hasCredits && <div><span className="pkg-price-credits">{p.priceCredits}</span></div>}
              {hasIdr && hasCredits && <div><span className="pkg-price-method">via IDR or credits</span></div>}
              {hasIdr && !hasCredits && <div><span className="pkg-price-method">via IDR</span></div>}
              {!hasIdr && hasCredits && <div><span className="pkg-price-method">via credits</span></div>}
              {isFree && <span className="pkg-price-free">Free</span>}
            </div>

            <dl className="pkg-facts">
              <div>
                <dt>Token allowance</dt>
                <dd>{unlimited
                  ? <span>Unlimited</span>
                  : <>{granted ? formatCounter(Number(granted)) : "—"}<small>tokens</small></>
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
                                      ? (pkg.baseRpm !== null && pkg.throttledRpm !== null
                                        ? <span style={{display:"inline-flex",alignItems:"center",gap:"4px"}}><strong>{pkg.baseRpm}</strong> → <strong>{pkg.throttledRpm}</strong><small style={{display:"block"}}>rpm</small></span>
                                        : pkg.baseRpm !== null
                                          ? <><strong>{pkg.baseRpm}</strong><small>rpm</small></>
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
                  onClick={() => setModelPopup({ models: pkg.models!, name: p.displayName })}>
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

            <div className="billing-plan-actions">
              {isCurrent
                ? <span className="billing-badge billing-badge-ok billing-plan-current">Current</span>
                : <>
                    {isFree
                      ? <button className="button button-ink compact-button" type="button" disabled={busy} onClick={() => void buy(p.id, "free")}>
                          {busy ? <><Loader2 size={14} className="row-spinner"/> …</> : <><Check size={14}/> Activate</>}
                        </button>
                      : <button className="button button-ink compact-button" type="button" disabled={busy} onClick={() => openPaymentPopup(p)}>
                          {busy ? <><Loader2 size={14} className="row-spinner"/> …</> : <><QrIcon size={14}/> Buy</>}
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
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => setInvoiceRefreshKey(k => k + 1)} disabled={invoiceStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>
      {(() => {
        const rows = invoiceResult?.data ?? [];
        const total = invoiceResult?.total ?? 0;
        const totalPages = invoiceResult?.totalPages ?? 1;
        const currentPage = invoiceResult?.page ?? 1;
        const start = total === 0 ? 0 : (currentPage - 1) * 10 + 1;
        const end = Math.min(currentPage * 10, total);

        return <>
          <div className="model-table-wrap">
            <table className="model-table">
              <thead><tr><th>ORDER ID</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th><th>ACTION</th></tr></thead>
              <tbody>
                {rows.length > 0
                  ? rows.map(t => <tr key={t.orderId}>
                      <td>
                        <code
                          className="cell-num"
                          style={{ cursor: "pointer", userSelect: "all" }}
                          title="Click to copy"
                          onClick={() => {
                            const text = t.orderId;
                            if (navigator.clipboard?.writeText) {
                              void navigator.clipboard.writeText(text);
                            } else {
                              const ta = document.createElement("textarea");
                              ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
                              document.body.appendChild(ta); ta.select();
                              try { document.execCommand("copy"); } catch {}
                              document.body.removeChild(ta);
                            }
                          }}
                        >{t.orderId}</code>
                      </td>
                      <td className="cell-num">
                        {formatRupiah(t.totalIdr)}
                        {t.feeIdr > 0 && <small className="cell-sub">{formatRupiah(t.amountIdr)} + {formatRupiah(t.feeIdr)} fee</small>}
                      </td>
                      <td className="cell-status">
                        {t.status === "canceled"
                          ? <button
                              type="button"
                              style={{ cursor: "pointer", border: "none", background: "transparent", color: "#7a2320", fontWeight: 700, fontSize: "11px", letterSpacing: "0.5px" }}
                              title="View cancel reason"
                              onClick={() => setCancelReason({ orderId: t.orderId, reason: t.expired ? "The QR code expired before payment was received." : "The order was canceled." })}
                            >{TOPUP_STATUS[t.status].label}</button>
                          : <span style={{ fontWeight: 700, fontSize: "11px", letterSpacing: "0.5px", color: t.status === "completed" ? "#12b3a4" : "#b8860b" }}>{TOPUP_STATUS[t.status].label}</span>}
                      </td>
                      <td>{formatWhen(t.createdAt)}</td>
                      <td>
                        {t.status === "pending"
                          ? <button className="row-action" type="button" title="Show QR" aria-label={`Show QR for ${t.orderId}`} onClick={() => {
                            setQrOrder({ orderId: t.orderId, qrString: t.qrString ?? null, totalIdr: t.totalIdr, amountIdr: t.amountIdr, feeIdr: t.feeIdr, expiresAt: t.expiresAt ?? null, isSandbox: t.isSandbox });
                            setQrStatus("pending");
                            setQrError("");
                            setCopied(false);
                            setQrOpen(true);
                          }}><QrIcon size={14}/></button>
                          : <span className="cell-muted">—</span>}
                      </td>
                    </tr>)
                  : <tr><td colSpan={5}><div className="table-empty">
                      {invoiceStatus === "loading"
                        ? <><Loader2 size={19} className="row-spinner"/><strong>Loading invoices…</strong></>
                        : invoiceStatus === "error"
                          ? <><X size={19}/><strong>Could not load invoice history</strong></>
                          : <><ReceiptText size={19}/><strong>No invoices yet</strong><p>Plan purchases will appear here.</p></>}
                    </div></td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && <div className="pagination">
            <span className="pagination-summary">Showing {start}–{end} of {total}</span>
            <div className="pagination-controls">
              <button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setInvoicePage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
              {pageWindow(currentPage, totalPages).map((n, i) => n === "gap"
                ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                : <button key={n} type="button" className={`page-number ${n === currentPage ? "page-current" : ""}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => setInvoicePage(n)}>{n}</button>)}
              <button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setInvoicePage(p => Math.min(totalPages, p + 1))}><ChevronRight size={15}/></button>
            </div>
          </div>}
        </>;
      })()}
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
      {(qrStatus === "pending" || qrStatus === "canceled") && qrOrder && <div className="topup-pay">
        {qrDead
          ? <div className="topup-qr topup-qr-dead" aria-hidden>
              <span className="topup-qr-void"><QrIcon size={30}/><small>CODE EXPIRED</small></span>
            </div>
          : qrStatus === "canceled"
          ? <div className="topup-qr topup-qr-dead" aria-hidden>
              <span className="topup-qr-void"><QrIcon size={30}/><small>ORDER CANCELED</small></span>
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
          {!qrDead && qrStatus === "pending" && <Countdown left={qrTimeLeft}/>}
        </div>
        {qrDead ? <div className="topup-dead" role="status">
          <Clock size={15}/>
          <div>
            <strong>"This code has expired"</strong>
            <span>
              {sandboxRefused
                ? "The payment went through, but this project is in sandbox mode so no credits were added."
                : "It was not paid in time, so it is canceled and cannot be scanned."}
              {" "}Try again to start a new one.
            </span>
          </div>
        </div> : qrStatus === "canceled" ? <div className="topup-dead" role="status">
          <AlertTriangle size={15}/>
          <div>
            <strong>This order was canceled</strong>
            <span>A newer checkout was started or the order was abandoned. This QRIS can no longer be used — if you already paid, contact support. Please start a new purchase.</span>
          </div>
        </div> : <div className="topup-status" role="status" aria-live="polite">
          <Loader2 size={14} className="row-spinner"/>
          <span>Waiting for payment… the page checks every few seconds.</span>
        </div>}
        {qrStatus === "pending" && !qrDead && <div className="modal-info-note">
          <strong>Important</strong>
          <span>Only pay using this QRIS. If you started another checkout, the previous QR is canceled and cannot be used.</span>
        </div>}
        {qrStatus === "pending" && !qrDead && qrOrder.qrString && <details className="topup-raw">
          <summary>Can&apos;t scan it? Copy the code</summary>
          <div className="topup-raw-row">
            <code>{qrOrder.qrString}</code>
            <button className="button button-outline compact-button" type="button" onClick={() => void copyQrString()}>
              {copied ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}
            </button>
          </div>
        </details>}
        {qrStatus === "pending" && !qrDead && qrOrder.isSandbox && <div className="modal-danger-note">
          <strong>Sandbox</strong>
          <span>This project is not live yet, so the QR cannot be paid from a real wallet. The plan is still activated so the flow can be tested.</span>
        </div>}
      </div>}
      {qrStatus === "completed" && <div className="topup-settled">
        <span className="topup-settled-mark"><Check size={26}/></span>
        <div className="topup-settled-copy">
          <strong>Plan activated</strong>
          <small>Your new package is now live.</small>
        </div>
      </div>}
    </Modal>

    {/* Models popup — shows the full model list for a package. */}
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

    {/* Payment method popup — select how to pay before creating an order. */}
    <Modal
      open={paymentPopup !== null}
      onClose={() => { setPaymentPopup(null); setPaymentPopupError(""); setSelectedMethodId(""); }}
      title={paymentPopup ? `Buy ${paymentPopup.plan.displayName}` : "Select payment method"}
      subtitle={paymentPopup ? `Select a payment method` : ""}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => { setPaymentPopup(null); setPaymentPopupError(""); setSelectedMethodId(""); }} disabled={paymentPopupBusy}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => void confirmPayment()} disabled={!selectedMethodId || paymentPopupBusy || paymentMethodsLoading}>
          {paymentPopupBusy ? <><Loader2 size={14} className="row-spinner"/> Processing…</> : "Continue"}
        </button>
      </>}
    >
      {paymentMethodsLoading && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading payment methods…</span></div>}
      {paymentPopupError && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>{paymentPopupError}</span></div>}
      {!paymentMethodsLoading && !paymentPopupError && paymentPopup && paymentPopup.methods.length > 0 && (
        <div className="payment-method-list">
          {(["credits", "idr", "usd"] as const).map(cat => {
            const catMethods = paymentPopup.methods.filter(m => m.category === cat);
            if (catMethods.length === 0) return null;
            const catLabel = cat === "credits" ? "Credits" : cat === "idr" ? "IDR (Indonesia Rupiah)" : "USD (Global)";
            return (
              <div key={cat} className="payment-method-group">
                <small className="payment-method-cat">{catLabel}</small>
                {catMethods.map(m => {
                  const price = cat === "credits"
                    ? `${paymentPopup.plan.priceCredits} credits`
                    : cat === "idr"
                      ? `Rp ${paymentPopup.plan.priceIdr.toLocaleString("id-ID")}`
                      : `$${(paymentPopup.plan.priceIdr / 15000).toFixed(2)}`;
                  const insufficientCredits = m.category === "credits" && Number(credits) < Number(paymentPopup.plan.priceCredits);
                  const isDisabled = insufficientCredits || !(m.visibility === "active" || m.visibility === "private" || m.isActive);
                  const disabledReason = !(m.visibility === "active" || m.visibility === "private" || m.isActive) ? " · Unavailable" : insufficientCredits ? " · Insufficient credits" : "";
                  return (
                    <label key={m.id} className={`payment-method-option${selectedMethodId === m.id ? " selected" : ""}${isDisabled ? " disabled" : ""}`}>
                      <input type="radio" name="paymentMethod" value={m.id} checked={selectedMethodId === m.id} onChange={() => !isDisabled && setSelectedMethodId(m.id)} disabled={isDisabled} />
                      <div className="payment-method-info">
                        <strong>{m.name}{isDisabled && <span className="payment-insufficient">{disabledReason}</span>}</strong>
                        {m.description && <small>{m.description}</small>}
                      </div>
                      <span className="payment-method-price">{price}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Modal>

    {/* Cancel reason popup — shows why an order was canceled. */}
    <Modal
      open={cancelReason !== null}
      onClose={() => setCancelReason(null)}
      title="Order canceled"
      subtitle={cancelReason?.orderId ?? ""}
      footer={<button className="button button-ink compact-button" type="button" onClick={() => setCancelReason(null)}><Check size={15}/> Close</button>}
    >
      {cancelReason && <p style={{ margin: 0 }}>{cancelReason.reason}</p>}
    </Modal>
  </div>;
}
