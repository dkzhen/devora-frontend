"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Coins, Loader2, RefreshCw, Save, Search, X } from "lucide-react";
import { formatRupiah, moneyToCredits } from "@/lib/credits";
import { formatCounter } from "@/lib/format-counter";

/**
 * The credit-to-rupiah rate: the one number that prices every top-up and values every balance.
 *
 * Rupiah only. A dollar figure was tried twice — first as its own column, then derived from an
 * exchange rate — and removed both times: it was a second number to keep in step with this one,
 * and QRIS settles in rupiah, so it had no consumer.
 */
type BillingSettings = {
  idrPerCredit: string;
  feeBearer: "buyer" | "merchant";
  updatedAt: string;
  updatedBy: string;
};

/** A quick-jump rupiah figure. The field itself takes any amount; these are the common ones. */
const QUICK_AMOUNTS = [10_000, 25_000, 50_000, 100_000];

/** Trim a stored 8-decimal rate to the shortest exact-looking form for the input box. */
function trimRate(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

const TX_PAGE_SIZE = 20;

/**
 * Which page buttons to render: a window around the current page, plus the first and last.
 *
 * Copied from the credits page so the admin transaction tables get the same pagination
 * behaviour — first and last always reachable, middle collapses to a gap.
 */
function pageWindow(current: number, total: number, span = 1): (number | "gap")[] {
  if (total <= span * 2 + 5) return Array.from({ length: total }, (_, i) => i + 1);

  const out: (number | "gap")[] = [1];
  const from = Math.max(2, current - span);
  const to = Math.min(total - 1, current + span);

  if (from > 2) out.push("gap");
  for (let n = from; n <= to; n++) out.push(n);
  if (to < total - 1) out.push("gap");
  out.push(total);

  return out;
}

export function AdminBillingSettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The form is a draft. Kept separate from `settings` so a save can be verified against what the
  // server returned rather than against what was typed.
  const [idr, setIdr] = useState("");
  const [feeBearer, setFeeBearer] = useState<"buyer" | "merchant">("buyer");

  // Section 04 + 05: admin-wide transaction and subscription lists.
  type TopupRow = {
    orderId: string; userId: string; email: string; credits: string;
    amountIdr: number; totalIdr: number; status: string; paymentMethod: string;
    kind: string; pricingPlanId: string | null; isSandbox: boolean;
    createdAt: string; completedAt: string | null;
  };
  type SubscriptionRow = {
    id: string; userId: string; email: string; packageId: string;
    packageName: string; tier: string; status: string;
    startedAt: string; expiresAt: string | null;
    tokensUsed: string; tokenCap: string | null;
  };
  const [topups, setTopups] = useState<TopupRow[] | null>(null);
  const [topupsStatus, setTopupsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[] | null>(null);
  const [subsStatus, setSubsStatus] = useState<"loading" | "ready" | "error">("loading");

  // Search + pagination state for the topups table (section 04) and subscriptions table (section 05).
  const [topupSearch, setTopupSearch] = useState("");
  const [topupPage, setTopupPage] = useState(1);
  const [subSearch, setSubSearch] = useState("");
  const [subPage, setSubPage] = useState(1);

  // Reset to page 1 when the search query changes.
  useEffect(() => { setTopupPage(1); }, [topupSearch]);
  useEffect(() => { setSubPage(1); }, [subSearch]);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/billing-settings", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { settings?: BillingSettings };
      if (!data.settings) { setStatus("error"); return; }
      setSettings(data.settings);
      setIdr(trimRate(data.settings.idrPerCredit));
      setFeeBearer(data.settings.feeBearer);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [authHeaders]);

  const loadTopups = useCallback(async () => {
    setTopupsStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/topups", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setTopupsStatus("error"); return; }
      const data = await res.json() as { topups?: TopupRow[] };
      setTopups(data.topups ?? []);
      setTopupsStatus("ready");
    } catch { setTopupsStatus("error"); }
  }, [authHeaders]);

  const loadSubscriptions = useCallback(async () => {
    setSubsStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/subscriptions", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setSubsStatus("error"); return; }
      const data = await res.json() as { subscriptions?: SubscriptionRow[] };
      setSubscriptions(data.subscriptions ?? []);
      setSubsStatus("ready");
    } catch { setSubsStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (status === "ready") { void loadTopups(); void loadSubscriptions(); } }, [status, loadTopups, loadSubscriptions]);

  const submit = async () => {
    setNotice(null);
    const idrText = idr.trim();
    const idrNumber = Number(idrText);
    if (idrText === "" || !Number.isFinite(idrNumber) || idrNumber <= 0) {
      setNotice({ kind: "error", text: "Enter how many rupiah one credit is worth." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/backend/api/v1/admin/billing-settings", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ idrPerCredit: idrText, feeBearer }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not save the rate." });
        return;
      }
      const data = await res.json() as { settings?: BillingSettings };
      if (data.settings) {
        // Re-seed the form from what the database actually stored, not from the input.
        setSettings(data.settings);
        setIdr(trimRate(data.settings.idrPerCredit));
        setFeeBearer(data.settings.feeBearer);
      }
      setNotice({ kind: "ok", text: "Rate saved. New top-ups use it; existing orders keep the rate they were placed at." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setSaving(false); }
  };

  // A live reading of the draft, so the operator sees the rate as money before saving it. This
  // is the same "state the reading under the raw number" rule the token ceiling follows.
  const draftIdr = Number(idr.trim());
  const draftValid = idr.trim() !== "" && Number.isFinite(draftIdr) && draftIdr > 0;

  const dirty = settings !== null && (
    trimRate(settings.idrPerCredit) !== trimRate(idr) ||
    settings.feeBearer !== feeBearer
  );

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Coins size={14}/> ADMIN / TRANSACTIONS</div>
        <h1>Transaction rate</h1>
        <p>What a credit is worth in rupiah. This prices every top-up and values every balance in the console.</p>
      </div>
      <button className="button button-outline compact-button" type="button" onClick={() => void load()} disabled={status === "loading"}>
        <RefreshCw size={15}/> Refresh
      </button>
    </div>

    {status === "loading" && <section className="console-section">
      <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading the rate…</strong></div>
    </section>}

    {status === "error" && <section className="console-section">
      <div className="table-empty"><X size={19}/><strong>Could not load the rate</strong><p>Check that the backend is reachable.</p></div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>The rate</h2><p>One credit is worth this much.</p></div></div>
        {settings && <span className="admin-editing-note">
          {settings.updatedAt === ""
            ? "Never set — showing the default."
            : <>Last set {new Date(settings.updatedAt).toLocaleString("id-ID")}{settings.updatedBy ? ` by ${settings.updatedBy}` : ""}.</>}
        </span>}
      </div>

      <div className="admin-form">
        <label className="admin-field">
          <span>Rupiah per credit</span>
          <input value={idr} inputMode="decimal" placeholder="1"
            onChange={e => setIdr(e.target.value)} />
          <small>The rate everything else follows. 1 means 1 credit = Rp 1.</small>
        </label>
      </div>

      {/* Raw digits above, the reading below — the operator should not have to count zeroes. */}
      <p className="admin-scale-note" aria-live="polite">
        {draftValid
          ? <><strong>{formatRupiah(draftIdr)}</strong> per credit</>
          : <><strong>—</strong> Enter a positive number of rupiah per credit.</>}
      </p>

      <div className="admin-subfield">
        <span className="admin-subfield-label">QRIS gateway fee</span>
        <p className="admin-subfield-hint">Who pays the payment gateway&apos;s cut when someone tops up.</p>
        <div className="kind-tiles">
          <button type="button"
            className={feeBearer === "buyer" ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={feeBearer === "buyer"}
            onClick={() => setFeeBearer("buyer")}>
            <span className="kind-tile-flag">{feeBearer === "buyer" ? "SELECTED" : ""}</span>
            <strong>Buyer pays</strong>
            <small>Charged on top of the credit price. The account receives the full credits it asked for.</small>
          </button>
          <button type="button"
            className={feeBearer === "merchant" ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={feeBearer === "merchant"}
            onClick={() => setFeeBearer("merchant")}>
            <span className="kind-tile-flag">{feeBearer === "merchant" ? "SELECTED" : ""}</span>
            <strong>You absorb it</strong>
            <small>Deducted from what the account pays, so fewer credits land than the amount transferred.</small>
          </button>
        </div>
      </div>

      <div className="admin-actions">
        <button className="button button-ink" type="button" onClick={() => void submit()} disabled={saving || !dirty}>
          {saving ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <>Save rate <Save size={16}/></>}
        </button>
        {!dirty && settings !== null && !notice && <span className="admin-editing-note">No changes to save.</span>}
        {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
          {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
        </p>}
      </div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>What this buys</h2><p>The rate as a customer sees it, before the gateway fee.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr><th>PAY</th><th>CREDITS</th></tr></thead>
          <tbody>
            {QUICK_AMOUNTS.map(amount => {
              const credits = draftValid ? moneyToCredits(amount, String(draftIdr)) : 0;
              return <tr key={amount}>
                <td className="cell-num">{formatRupiah(amount)}</td>
                <td className="cell-num"><strong>{credits.toLocaleString("id-ID", { maximumFractionDigits: 6 })}</strong></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="table-note"><AlertTriangle size={14}/> A rate change reprices future top-ups and how balances read. Orders already placed keep the rate they were created with.</div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">03</span><div><h2>Current state</h2><p>What the database holds right now.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <tbody>
            <tr><td><strong>Rupiah per credit</strong></td><td className="cell-num">{settings ? formatRupiah(Number(settings.idrPerCredit)) : "—"}</td></tr>
            <tr><td><strong>QRIS fee paid by</strong></td><td className="cell-num">{settings?.feeBearer === "merchant" ? "you (absorbed)" : "the buyer"}</td></tr>
            <tr><td><strong>Last changed</strong></td><td className="cell-num">{settings && settings.updatedAt !== ""
              ? new Date(settings.updatedAt).toLocaleString("id-ID")
              : "never"}</td></tr>
          </tbody>
        </table>
      </div>
    </section>}

    {/* Section 04: Credit transactions across all users. */}
    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">04</span><div><h2>Credit transactions</h2><p>All top-up and plan purchase orders, newest first.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadTopups()} disabled={topupsStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {topupsStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading transactions…</strong></div>}
      {topupsStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load transactions</strong></div>}

      {topupsStatus === "ready" && topups && <>
        {(() => {
          const pending = topups.filter(t => t.status === "pending").length;
          const completed = topups.filter(t => t.status === "completed").length;
          const canceled = topups.filter(t => t.status === "canceled").length;
          const totalIdr = topups.filter(t => t.status === "completed").reduce((s, t) => s + t.totalIdr, 0);
          return <div className="usage-grid stats-grid">
            <article className="usage-stat"><strong>{pending}</strong><small><span>Pending</span></small></article>
            <article className="usage-stat"><strong>{completed}</strong><small><span>Completed</span></small></article>
            <article className="usage-stat"><strong>{canceled}</strong><small><span>Canceled</span></small></article>
            <article className="usage-stat"><strong>{formatCounter(totalIdr)}</strong><small><span>IDR volume (completed)</span></small></article>
          </div>;
        })()}

        {(() => {
          const q = topupSearch.trim().toLowerCase();
          const filtered = q === ""
            ? topups
            : topups.filter(t =>
                t.email.toLowerCase().includes(q) ||
                t.orderId.toLowerCase().includes(q) ||
                t.status.toLowerCase().includes(q) ||
                t.kind.toLowerCase().includes(q));
          const pageCount = Math.max(1, Math.ceil(filtered.length / TX_PAGE_SIZE));
          const page = Math.min(topupPage, pageCount);
          const rows = filtered.slice((page - 1) * TX_PAGE_SIZE, page * TX_PAGE_SIZE);
          return <>
            <label className="search-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <Search size={14}/>
              <input value={topupSearch} onChange={e => setTopupSearch(e.target.value)} placeholder="Search by email, order ID, status, kind…" aria-label="Search transactions"/>
            </label>
            <div className="model-table-wrap" style={{ marginTop: 8 }}>
              <table className="model-table">
                <thead><tr><th>EMAIL</th><th>ORDER ID</th><th>CREDITS</th><th>AMOUNT</th><th>STATUS</th><th>KIND</th><th>CREATED</th></tr></thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={7} className="cell-num" style={{ textAlign: "center", padding: "20px" }}>{q ? "No matches." : "No transactions yet."}</td></tr>}
                  {rows.map(t => <tr key={t.orderId}>
                    <td>{t.email}</td>
                    <td className="cell-num">{t.orderId}</td>
                    <td className="cell-num">{formatCounter(Number(t.credits))}</td>
                    <td className="cell-num">{formatRupiah(t.amountIdr)}</td>
                    <td><span className={`status-pill status-${t.status}`}>{t.status}</span></td>
                    <td>{t.kind}</td>
                    <td className="cell-num">{new Date(t.createdAt).toLocaleString("en-GB")}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {filtered.length > TX_PAGE_SIZE && <div className="pagination">
              <span className="pagination-summary">Showing {(page - 1) * TX_PAGE_SIZE + 1}–{Math.min(page * TX_PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="pagination-controls">
                <button type="button" className="icon-button" aria-label="Previous page" disabled={page === 1} onClick={() => setTopupPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
                {pageWindow(page, pageCount).map((n, i) => n === "gap"
                  ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                  : <button key={n} type="button" className={`page-number ${n === page ? "page-current" : ""}`} aria-current={n === page ? "page" : undefined} onClick={() => setTopupPage(n)}>{n}</button>)}
                <button type="button" className="icon-button" aria-label="Next page" disabled={page === pageCount} onClick={() => setTopupPage(p => Math.min(pageCount, p + 1))}><ChevronRight size={15}/></button>
              </div>
            </div>}
          </>;
        })()}
      </>}
    </section>}

    {/* Section 05: Package subscriptions across all users. */}
    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">05</span><div><h2>Package subscriptions</h2><p>All active and past package subscriptions, newest first.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadSubscriptions()} disabled={subsStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {subsStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading subscriptions…</strong></div>}
      {subsStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load subscriptions</strong></div>}

      {subsStatus === "ready" && subscriptions && <>
        {(() => {
          const active = subscriptions.filter(s => s.status === "active").length;
          const expired = subscriptions.filter(s => s.status === "expired").length;
          const cancelled = subscriptions.filter(s => s.status === "cancelled").length;
          return <div className="usage-grid stats-grid">
            <article className="usage-stat"><strong>{active}</strong><small><span>Active</span></small></article>
            <article className="usage-stat"><strong>{expired}</strong><small><span>Expired</span></small></article>
            <article className="usage-stat"><strong>{cancelled}</strong><small><span>Cancelled</span></small></article>
          </div>;
        })()}

        {(() => {
          const q = subSearch.trim().toLowerCase();
          const filtered = q === ""
            ? subscriptions
            : subscriptions.filter(s =>
                s.email.toLowerCase().includes(q) ||
                s.packageName.toLowerCase().includes(q) ||
                s.tier.toLowerCase().includes(q) ||
                s.status.toLowerCase().includes(q));
          const pageCount = Math.max(1, Math.ceil(filtered.length / TX_PAGE_SIZE));
          const page = Math.min(subPage, pageCount);
          const rows = filtered.slice((page - 1) * TX_PAGE_SIZE, page * TX_PAGE_SIZE);
          return <>
            <label className="search-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <Search size={14}/>
              <input value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="Search by email, package, tier, status…" aria-label="Search subscriptions"/>
            </label>
            <div className="model-table-wrap" style={{ marginTop: 8 }}>
              <table className="model-table">
                <thead><tr><th>EMAIL</th><th>PACKAGE</th><th>TIER</th><th>STATUS</th><th>STARTED</th><th>EXPIRES</th><th>TOKENS USED</th></tr></thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={7} className="cell-num" style={{ textAlign: "center", padding: "20px" }}>{q ? "No matches." : "No subscriptions yet."}</td></tr>}
                  {rows.map(s => <tr key={s.id}>
                    <td>{s.email}</td>
                    <td>{s.packageName}</td>
                    <td>{s.tier}</td>
                    <td><span className={`status-pill status-${s.status}`}>{s.status}</span></td>
                    <td className="cell-num">{new Date(s.startedAt).toLocaleString("en-GB")}</td>
                    <td className="cell-num">{s.expiresAt ? new Date(s.expiresAt).toLocaleString("en-GB") : "lifetime"}</td>
                    <td className="cell-num">{formatCounter(Number(s.tokensUsed))}{s.tokenCap ? ` / ${formatCounter(Number(s.tokenCap))}` : ""}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {filtered.length > TX_PAGE_SIZE && <div className="pagination">
              <span className="pagination-summary">Showing {(page - 1) * TX_PAGE_SIZE + 1}–{Math.min(page * TX_PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="pagination-controls">
                <button type="button" className="icon-button" aria-label="Previous page" disabled={page === 1} onClick={() => setSubPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
                {pageWindow(page, pageCount).map((n, i) => n === "gap"
                  ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                  : <button key={n} type="button" className={`page-number ${n === page ? "page-current" : ""}`} aria-current={n === page ? "page" : undefined} onClick={() => setSubPage(n)}>{n}</button>)}
                <button type="button" className="icon-button" aria-label="Next page" disabled={page === pageCount} onClick={() => setSubPage(p => Math.min(pageCount, p + 1))}><ChevronRight size={15}/></button>
              </div>
            </div>}
          </>;
        })()}
      </>}
    </section>}
  </div>;
}
