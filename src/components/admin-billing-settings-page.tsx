"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, ChevronLeft, ChevronRight, Coins, Loader2, RefreshCw, Search, Settings, X, Eye, Check, Copy } from "lucide-react";
import { formatUsd, formatIdr } from "@/lib/credits";
import { formatCounter } from "@/lib/format-counter";
import { Modal } from "@/components/modal";

/**
 * Which page buttons to render: a window around the current page, plus the first and last.
 *
 * Copied from the credits page so the admin transaction tables get the same pagination
 * behaviour — first and last always reachable, middle collapses to a gap.
 */
/**
 * Show up to 5 page numbers around the current page.
 * - Near the start: 1 2 3 4 5 ...
 * - In the middle: ... 3 4 5 6 7 ...
 * - Near the end: ... 4 5 6 7
 * Total pages <= 5: show all, no gaps.
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
 * A table cell whose text can be copied with one click.
 *
 * `navigator.clipboard` only exists in a secure context, and the admin console is
 * reached over plain HTTP on the LAN — so it falls back to a hidden textarea +
 * `execCommand("copy")`, the same path the top-up dialog uses. The button shows a
 * check for two seconds after a successful copy.
 */
function CopyCell({ value, title }: { value: string | null; title?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <td className="cell-num">—</td>;

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the text is still selectable */ }
  };

  return <td className="cell-num">
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 260 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title ?? value}>{value}</span>
      <button type="button" className="icon-button" title="Copy" onClick={copy} aria-label="Copy">
        {copied ? <Check size={13}/> : <Copy size={13}/>}
      </button>
    </span>
  </td>;
}

export function AdminBillingSettingsPage() {
  const { getToken } = useAuth();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  type TransactionRow = {
    id: string; userId: string; email: string; status: string;
    currency: string; amountCurrency: string; creditsAmount: string;
    pricingPlanId: string | null; gatewayOrderId: string | null;
    gatewayTxnId: string | null; kind: string | null;
    topupStatus: string | null; isSandbox: boolean | null;
    createdAt: string; updatedAt: string;
    // Detail-popup only — not shown as table columns.
    qrString: string | null; vaNumber: string | null;
    expiresAt: string | null; completedAt: string | null;
    gateway: string | null; paymentMethodName: string | null;
  };
  type SubscriptionRow = {
    id: string; userId: string; email: string; packageId: string;
    packageName: string; tier: string; status: string;
    startedAt: string; expiresAt: string | null;
    tokensUsed: string; tokenCap: string | null;
  };
  type TxResult = { data: TransactionRow[]; total: number; totalPages: number; page: number; stats: TxStats | null };
  type TxStats = { completed: number; pending: number; canceled: number; paidUsd: number; paidIdr: number; paidTotalIdr: number; usdRate: number };
  type SubResult = { data: SubscriptionRow[]; total: number; totalPages: number; page: number; stats?: { active: number; expired: number; cancelled: number } | null };
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [txStatus, setTxStatus] = useState<"loading" | "ready" | "error">("loading");
  const [txRefreshKey, setTxRefreshKey] = useState(0);
  const [subResult, setSubResult] = useState<SubResult | null>(null);
  const [subStatus, setSubStatus] = useState<"loading" | "ready" | "error">("loading");
  const [subRefreshKey, setSubRefreshKey] = useState(0);

  // Search + pagination state for the topups table (section 00) and subscriptions table (section 01).
  const [topupSearch, setTopupSearch] = useState("");
  const [topupPage, setTopupPage] = useState(1);
  const [topupFilter, setTopupFilter] = useState<"all" | "completed" | "pending" | "canceled">("all");
  const [subSearch, setSubSearch] = useState("");
  const [subPage, setSubPage] = useState(1);
  const [subFilter, setSubFilter] = useState<"all" | "active" | "expired" | "cancelled">("all");
  const [sweeping, setSweeping] = useState(false);

  // Order override modal (section 00): force-complete or cancel a pending order.
  const [overrideTarget, setOverrideTarget] = useState<TransactionRow | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<"completed" | "canceled">("completed");
  const [overriding, setOverriding] = useState(false);
  const [overrideError, setOverrideError] = useState("");

  // Read-only detail popup: every field for one order, gateway txn id included.
  const [detailTarget, setDetailTarget] = useState<TransactionRow | null>(null);

  // Reset to page 1 when the search query or filter changes.
  useEffect(() => { setTopupPage(1); }, [topupSearch, topupFilter]);
  useEffect(() => { setSubPage(1); }, [subSearch, subFilter]);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  // Single fetch effect for transactions (Section 00).
  // The effect owns the AbortController — cleanup aborts the in-flight request.
  // txResult is committed atomically: data + total + page always come from the same response.
  // authHeaders is stable (useCallback with [getToken] dep), so it won't cause re-fetches.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setTxStatus("loading");

      const params = new URLSearchParams({ page: String(topupPage), limit: "20" });
      if (topupSearch) params.set("search", topupSearch);
      if (topupFilter !== "all") params.set("status", topupFilter);

      try {
        const res = await fetch(`/backend/api/v1/admin/transactions?${params}`, {
          headers: await authHeaders(), cache: "no-store", signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) setTxStatus("error");
          return;
        }
        const data = await res.json() as { transactions?: TransactionRow[]; pagination?: { total: number; totalPages: number; page: number }; stats?: TxStats };
        if (!controller.signal.aborted) {
          setTxResult({
            data: data.transactions ?? [],
            total: data.pagination?.total ?? 0,
            totalPages: data.pagination?.totalPages ?? 1,
            page: data.pagination?.page ?? topupPage,
            stats: data.stats ?? null,
          });
          setTxStatus("ready");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) setTxStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [topupPage, topupSearch, topupFilter, authHeaders, txRefreshKey]);

  // Single fetch effect for subscriptions (Section 01).
  // The effect owns the AbortController — cleanup aborts the in-flight request.
  // subResult is committed atomically: data + total + page always come from the same response.
  // authHeaders is stable (useCallback with [getToken] dep), so it won't cause re-fetches.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setSubStatus("loading");

      const params = new URLSearchParams({ page: String(subPage), limit: "20" });
      if (subSearch) params.set("search", subSearch);
      if (subFilter !== "all") params.set("status", subFilter);

      try {
        const res = await fetch(`/backend/api/v1/admin/subscriptions?${params}`, {
          headers: await authHeaders(), cache: "no-store", signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) setSubStatus("error");
          return;
        }
        const data = await res.json() as { subscriptions?: SubscriptionRow[]; pagination?: { total: number; totalPages: number; page: number }; stats?: { active: number; expired: number; cancelled: number } };
        if (!controller.signal.aborted) {
          setSubResult({
            data: data.subscriptions ?? [],
            total: data.pagination?.total ?? 0,
            totalPages: data.pagination?.totalPages ?? 1,
            page: data.pagination?.page ?? subPage,
            stats: data.stats ?? null,
          });
          setSubStatus("ready");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) setSubStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [subPage, subSearch, subFilter, authHeaders, subRefreshKey]);

  const doSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch("/backend/api/v1/admin/sweep-subscriptions", {
        method: "POST", headers: await authHeaders(),
      });
      if (!res.ok) {
        setNotice({ kind: "error", text: "Could not sweep subscriptions." });
        return;
      }
      const data = await res.json() as { expired?: number; planReset?: boolean };
      setNotice({ kind: "ok", text: `Swept ${data.expired ?? 0} lapsed subscriptions${data.planReset ? " — plan tiers reset" : ""}.` });
      setSubRefreshKey(k => k + 1);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally { setSweeping(false); }
  };

  const doOverride = async () => {
    if (!overrideTarget) return;
    setOverriding(true);
    setOverrideError("");
    try {
      const res = await fetch(`/backend/api/v1/admin/topups/${overrideTarget.gatewayOrderId}/override`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ status: overrideStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setOverrideError(body?.error?.message ?? "Could not override the order.");
        return;
      }
      setOverrideTarget(null);
      setTxRefreshKey(k => k + 1);
    } catch {
      setOverrideError("Could not reach the gateway.");
    } finally { setOverriding(false); }
  };

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Coins size={14}/> ADMIN / TRANSACTIONS</div>
        <h1>Transactions</h1>
        <p>All credit top-ups, plan purchases, and payment history.</p>
      </div>
    </div>

    {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
      {notice.kind === "ok" ? "✓" : "✕"}{notice.text}
    </p>}

    {/* Section 00: Credit transactions across all users. */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">00</span><div><h2>Credit transactions</h2><p>All top-up and plan purchase orders, newest first.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => setTxRefreshKey(k => k + 1)} disabled={txStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {txStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load transactions.</span></div>}

      {(txStatus === "loading" || txStatus === "ready") && <>
        {(() => {
          const s = txResult?.stats;
          return <div className="usage-grid stats-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {/* One card for order counts, with the status breakdown living inside it. */}
            <article className="usage-stat">
              <strong>{txResult?.total ?? 0}</strong>
              <small><span>Total orders</span></small>
              <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: "var(--fs-small)", flexWrap: "wrap" }}>
                <span style={{ color: "#2e7d32" }}>● {s?.completed ?? 0} success</span>
                <span style={{ color: "#b8860b" }}>● {s?.pending ?? 0} pending</span>
                <span style={{ color: "#c62828" }}>● {s?.canceled ?? 0} failed</span>
              </div>
            </article>
            {/* One card for money — headline is both currencies folded into IDR at
                the live (markup-inclusive) rate; the per-currency split sits under it. */}
            <article className="usage-stat">
              <strong>{formatIdr(s?.paidTotalIdr ?? 0)}</strong>
              <small><span>Total paid (IDR equivalent)</span></small>
              <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: "var(--fs-small)", flexWrap: "wrap" }}>
                <span>{formatUsd(s?.paidUsd ?? 0)} USD</span>
                <span>{formatIdr(s?.paidIdr ?? 0)} IDR</span>
              </div>
            </article>
          </div>;
        })()}

        {(() => {
          const rows = txResult?.data ?? [];
          const total = txResult?.total ?? 0;
          const totalPages = txResult?.totalPages ?? 1;
          // currentPage comes from the committed response, NOT topupPage (optimistic local state).
          // This ensures the page label and range are always consistent with the displayed rows.
          const currentPage = txResult?.page ?? 1;
          const start = total === 0 ? 0 : (currentPage - 1) * 20 + 1;
          const end = Math.min(currentPage * 20, total);
          return <>
            <label className="search-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <Search size={14}/>
              <input value={topupSearch} onChange={e => setTopupSearch(e.target.value)} placeholder="Search by email, order ID, status, kind…" aria-label="Search transactions"/>
            </label>
            <div className="filter-pills" style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {(["all", "completed", "pending", "canceled"] as const).map(f => (
                <button key={f} type="button"
                  className={topupFilter === f ? "plan-pill plan-pill-on" : "plan-pill"}
                  onClick={() => { setTopupFilter(f); setTopupPage(1); }}>
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="model-table-wrap" style={{ marginTop: 8 }}>
              <table className="model-table">
                <thead><tr><th style={{ whiteSpace: "nowrap" }}>ORDER ID</th><th style={{ whiteSpace: "nowrap" }}>PAID</th><th style={{ whiteSpace: "nowrap" }}>STATUS</th><th style={{ whiteSpace: "nowrap" }}>KIND</th><th style={{ whiteSpace: "nowrap" }}>CREATED</th><th style={{ whiteSpace: "nowrap" }}>ACTIONS</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="cell-num" style={{ textAlign: "center", padding: "20px" }}>{topupSearch ? "No matches." : "No transactions yet."}</td></tr>}
                  {rows.map(t => <tr key={t.id}>
                    <CopyCell value={t.gatewayOrderId} />
                    <td className="cell-num">{t.currency === "IDR" ? formatIdr(Number(t.amountCurrency)) : formatUsd(Number(t.amountCurrency))}</td>
                    <td><span className={`status-pill status-${t.status}`}>{t.status}</span></td>
                    <td>{t.kind ?? "—"}</td>
                    <td className="cell-num">{new Date(t.createdAt).toLocaleString("en-GB")}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="button button-outline compact-button"
                          type="button"
                          title="View full details"
                          onClick={() => setDetailTarget(t)}
                        >
                          <Eye size={14}/>
                        </button>
                        {t.gatewayOrderId && (
                          <button
                            className="button button-outline compact-button"
                            type="button"
                            title="Override order status"
                            onClick={() => { setOverrideTarget(t); setOverrideStatus("completed"); setOverrideError(""); }}
                          >
                            <Settings size={14}/>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {/* Pagination only applies to plain browsing — a search returns every
                match, so there are no further pages to walk. */}
            {totalPages > 1 && !topupSearch && <div className="pagination">
              <span className="pagination-summary">Showing {start}–{end} of {total}</span>
              <div className="pagination-controls">
                <button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setTopupPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
                {pageWindow(currentPage, totalPages).map((n, i) => n === "gap"
                  ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                  : <button key={n} type="button" className={`page-number ${n === currentPage ? "page-current" : ""}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => setTopupPage(n)}>{n}</button>)}
                <button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setTopupPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={15}/></button>
              </div>
            </div>}
          </>;
        })()}
      </>}
    </section>

    {/* Section 01: Package subscriptions across all users. */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Package subscriptions</h2><p>All active and past package subscriptions, newest first.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => void doSweep()} disabled={sweeping}>
          {sweeping ? <><Loader2 size={15} className="row-spinner"/> Sweeping…</> : <><AlertTriangle size={15}/> Sweep expired</>}
        </button>
        <button className="button button-outline compact-button" type="button" onClick={() => setSubRefreshKey(k => k + 1)} disabled={subStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {subStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load subscriptions.</span></div>}

      {(subStatus === "loading" || subStatus === "ready") && <>
        {(() => {
          const rows = subResult?.data ?? [];
          const active = subResult?.stats?.active ?? rows.filter(s => s.status === "active").length;
          const expired = subResult?.stats?.expired ?? rows.filter(s => s.status === "expired").length;
          const cancelled = subResult?.stats?.cancelled ?? rows.filter(s => s.status === "cancelled").length;
          return <div className="usage-grid stats-grid">
            <article className="usage-stat"><strong>{active}</strong><small><span>Active</span></small></article>
            <article className="usage-stat"><strong>{expired}</strong><small><span>Expired</span></small></article>
            <article className="usage-stat"><strong>{cancelled}</strong><small><span>Cancelled</span></small></article>
            <article className="usage-stat"><strong>{subResult?.total ?? 0}</strong><small><span>Total</span></small></article>
          </div>;
        })()}

        {(() => {
          const rows = subResult?.data ?? [];
          const total = subResult?.total ?? 0;
          const totalPages = subResult?.totalPages ?? 1;
          // currentPage comes from the committed response, NOT subPage (optimistic local state).
          // This ensures the page label and range are always consistent with the displayed rows.
          const currentPage = subResult?.page ?? 1;
          const start = total === 0 ? 0 : (currentPage - 1) * 20 + 1;
          const end = Math.min(currentPage * 20, total);
          return <>
            <label className="search-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <Search size={14}/>
              <input value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="Search by email, package, tier, status…" aria-label="Search subscriptions"/>
            </label>
            <div className="filter-pills" style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {(["all", "active", "expired", "cancelled"] as const).map(f => (
                <button key={f} type="button"
                  className={subFilter === f ? "plan-pill plan-pill-on" : "plan-pill"}
                  onClick={() => { setSubFilter(f); setSubPage(1); }}>
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="model-table-wrap" style={{ marginTop: 8 }}>
              <table className="model-table">
                <thead><tr><th style={{ whiteSpace: "nowrap" }}>EMAIL</th><th style={{ whiteSpace: "nowrap" }}>PACKAGE</th><th style={{ whiteSpace: "nowrap" }}>TIER</th><th style={{ whiteSpace: "nowrap" }}>STATUS</th><th style={{ whiteSpace: "nowrap" }}>STARTED</th><th style={{ whiteSpace: "nowrap" }}>EXPIRES</th><th style={{ whiteSpace: "nowrap" }}>TOKENS USED</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="cell-num" style={{ textAlign: "center", padding: "20px" }}>{subSearch ? "No matches." : "No subscriptions yet."}</td></tr>}
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
            {totalPages > 1 && <div className="pagination">
              <span className="pagination-summary">Showing {start}–{end} of {total}</span>
              <div className="pagination-controls">
                <button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setSubPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
                {pageWindow(currentPage, totalPages).map((n, i) => n === "gap"
                  ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                  : <button key={n} type="button" className={`page-number ${n === currentPage ? "page-current" : ""}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => setSubPage(n)}>{n}</button>)}
                <button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setSubPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={15}/></button>
              </div>
            </div>}
          </>;
        })()}
      </>}
    </section>

    {/* Detail popup: every field for one order, gateway txn id included. */}
    <Modal
      open={detailTarget !== null}
      title="Transaction details"
      subtitle={detailTarget?.gatewayOrderId ?? undefined}
      onClose={() => setDetailTarget(null)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setDetailTarget(null)}>Close</button>
      </>}
    >
      {detailTarget && (() => {
        const t = detailTarget;
        const isUsd = t.currency === "USD";
        const fmt = (v: string | null, mono = false) => v ?? "—";
        return <>
          <div className="model-table-wrap">
            <table className="model-table">
              <tbody>
                <tr><td><strong>Order ID</strong></td><td className="cell-num">{t.gatewayOrderId ?? "—"}</td></tr>
                <tr><td><strong>Gateway txn ID</strong></td><td className="cell-num" style={{ wordBreak: "break-all" }}>{fmt(t.gatewayTxnId, true)}</td></tr>
                <tr><td><strong>Payment order ID</strong></td><td className="cell-num" style={{ wordBreak: "break-all" }}>{t.id}</td></tr>
                <tr><td><strong>User email</strong></td><td>{t.email}</td></tr>
                <tr><td><strong>User ID</strong></td><td className="cell-num" style={{ wordBreak: "break-all" }}>{t.userId}</td></tr>
                <tr><td><strong>Status</strong></td><td><span className={`status-pill status-${t.status}`}>{t.status}</span></td></tr>
                <tr><td><strong>Kind</strong></td><td>{t.kind ?? "—"}</td></tr>
                <tr><td><strong>Gateway</strong></td><td>{t.gateway ?? "—"}{t.paymentMethodName ? ` (${t.paymentMethodName})` : ""}</td></tr>
                <tr><td><strong>Paid</strong></td><td className="cell-num">{isUsd ? formatUsd(Number(t.amountCurrency)) : formatIdr(Number(t.amountCurrency))}</td></tr>
                <tr><td><strong>Currency</strong></td><td>{t.currency}</td></tr>
                <tr><td><strong>Credits</strong></td><td className="cell-num">{formatCounter(Number(t.creditsAmount))}</td></tr>
                <tr><td><strong>Sandbox</strong></td><td>{t.isSandbox ? "Yes" : "No"}</td></tr>
                <tr><td><strong>Topup status</strong></td><td>{t.topupStatus ?? "—"}</td></tr>
                <tr><td><strong>Created</strong></td><td className="cell-num">{new Date(t.createdAt).toLocaleString("en-GB")}</td></tr>
                <tr><td><strong>Updated</strong></td><td className="cell-num">{new Date(t.updatedAt).toLocaleString("en-GB")}</td></tr>
                <tr><td><strong>Expires</strong></td><td className="cell-num">{t.expiresAt ? new Date(t.expiresAt).toLocaleString("en-GB") : "—"}</td></tr>
                <tr><td><strong>Completed</strong></td><td className="cell-num">{t.completedAt ? new Date(t.completedAt).toLocaleString("en-GB") : "—"}</td></tr>
                {t.pricingPlanId && <tr><td><strong>Pricing plan</strong></td><td className="cell-num" style={{ wordBreak: "break-all" }}>{t.pricingPlanId}</td></tr>}
                {t.vaNumber && <tr><td><strong>VA number</strong></td><td className="cell-num">{t.vaNumber}</td></tr>}
              </tbody>
            </table>
          </div>
          {t.qrString && <div className="admin-subfield" style={{ marginTop: 14 }}>
            <span className="admin-subfield-label">QR string / crypto invoice ref</span>
            <code style={{ display: "block", fontSize: "var(--fs-small)", wordBreak: "break-all", background: "var(--cream)", padding: "10px 12px", borderRadius: 4 }}>{t.qrString}</code>
          </div>}
        </>;
      })()}
    </Modal>

    {/* Override modal: force-complete or cancel a pending order. */}
    <Modal
      open={overrideTarget !== null}
      title="Override order status"
      subtitle="Force-settle or cancel a pending order. This cannot be undone."
      onClose={() => { if (!overriding) setOverrideTarget(null); }}
      busy={overriding}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setOverrideTarget(null)} disabled={overriding}>
          Cancel
        </button>
        <button className="button button-ink" type="button" onClick={() => void doOverride()} disabled={overriding}>
          {overriding ? <><Loader2 size={15} className="row-spinner"/> Overriding…</> : <>Confirm override</>}
        </button>
      </>}
    >
      {overrideTarget && <>
        <div className="model-table-wrap">
          <table className="model-table">
            <tbody>
              <tr><td><strong>Order ID</strong></td><td className="cell-num">{overrideTarget.gatewayOrderId ?? "—"}</td></tr>
              <tr><td><strong>User email</strong></td><td>{overrideTarget.email}</td></tr>
              <tr><td><strong>Current status</strong></td><td><span className={`status-pill status-${overrideTarget.status}`}>{overrideTarget.status}</span></td></tr>
              <tr><td><strong>Kind</strong></td><td>{overrideTarget.kind ?? "—"}</td></tr>
              <tr><td><strong>Amount</strong></td><td className="cell-num">{overrideTarget.currency === "IDR" ? formatIdr(Number(overrideTarget.amountCurrency)) : formatUsd(Number(overrideTarget.amountCurrency))}</td></tr>
              <tr><td><strong>Credits</strong></td><td className="cell-num">{formatCounter(Number(overrideTarget.creditsAmount))}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="admin-subfield" style={{ marginTop: 16 }}>
          <span className="admin-subfield-label">Set new status</span>
          <div className="kind-tiles">
            <button type="button"
              className={overrideStatus === "completed" ? "kind-tile kind-tile-on" : "kind-tile"}
              aria-pressed={overrideStatus === "completed"}
              onClick={() => setOverrideStatus("completed")}
            >
              <span className="kind-tile-flag">{overrideStatus === "completed" ? "SELECTED" : ""}</span>
              <strong>Mark as paid</strong>
              <small>Force-settle the order: grants credits or activates the subscription.</small>
            </button>
            <button type="button"
              className={overrideStatus === "canceled" ? "kind-tile kind-tile-on" : "kind-tile"}
              aria-pressed={overrideStatus === "canceled"}
              onClick={() => setOverrideStatus("canceled")}
            >
              <span className="kind-tile-flag">{overrideStatus === "canceled" ? "SELECTED" : ""}</span>
              <strong>Cancel order</strong>
              <small>Mark the order as canceled. No credits or subscription are granted.</small>
            </button>
          </div>
        </div>
        {overrideError && <p className="voucher-message voucher-error" role="status"><X size={14}/>{overrideError}</p>}
      </>}
    </Modal>
  </div>;
}
