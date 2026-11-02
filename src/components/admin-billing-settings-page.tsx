"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, ChevronLeft, ChevronRight, Coins, Loader2, RefreshCw, Search, Settings, X } from "lucide-react";
import { formatRupiah } from "@/lib/credits";
import { formatCounter } from "@/lib/format-counter";
import { Modal } from "@/components/modal";

const TX_PAGE_SIZE = 20; // used for subscriptions client-side pagination

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

  const out: (number | "gap")[] = [];
  const from = Math.max(1, Math.min(current - 2, total - 4));
  const to = Math.min(total, from + 4);

  if (from > 1) {
    out.push(1);
    if (from > 2) out.push("gap");
  }
  for (let n = from; n <= to; n++) out.push(n);
  if (to < total) {
    if (to < total - 1) out.push("gap");
    out.push(total);
  }

  return out;
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
  };
  type Pagination = { page: number; limit: number; total: number; totalPages: number };
  type SubscriptionRow = {
    id: string; userId: string; email: string; packageId: string;
    packageName: string; tier: string; status: string;
    startedAt: string; expiresAt: string | null;
    tokensUsed: string; tokenCap: string | null;
  };
  const [topups, setTopups] = useState<TransactionRow[] | null>(null);
  const [topupsStatus, setTopupsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[] | null>(null);
  const [subsStatus, setSubsStatus] = useState<"loading" | "ready" | "error">("loading");

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

  // Reset to page 1 when the search query or filter changes.
  useEffect(() => { setTopupPage(1); }, [topupSearch, topupFilter]);
  useEffect(() => { setSubPage(1); }, [subSearch]);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  // Track the in-flight AbortController so a new page click cancels the previous fetch.
  const topupAbortRef = useRef<AbortController | null>(null);

  const loadTopups = useCallback(async (overridePage?: number) => {
    // Cancel any in-flight fetch — only the latest click wins.
    topupAbortRef.current?.abort();
    const ac = new AbortController();
    topupAbortRef.current = ac;

    setTopupsStatus("loading");
    const p = overridePage ?? topupPage;
    const params = new URLSearchParams({ page: String(p), limit: "20" });
    if (topupSearch) params.set("search", topupSearch);
    if (topupFilter !== "all") params.set("status", topupFilter);

    try {
      const res = await fetch(`/backend/api/v1/admin/transactions?${params}`, {
        headers: await authHeaders(), cache: "no-store", signal: ac.signal,
      });
      if (!res.ok) { if (!ac.signal.aborted) setTopupsStatus("error"); return; }
      const data = await res.json() as { transactions?: TransactionRow[]; pagination?: Pagination };
      // Only apply if this fetch wasn't superseded.
      if (!ac.signal.aborted) {
        setTopups(data.transactions ?? []);
        setPagination(data.pagination ?? null);
        setTopupsStatus("ready");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // expected — cancelled
      if (!ac.signal.aborted) setTopupsStatus("error");
    }
  }, [authHeaders, topupPage, topupSearch, topupFilter]);

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
      void loadSubscriptions();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server." });
    } finally { setSweeping(false); }
  };

  // Fetch on page/search/filter change — AbortController ensures only the latest wins.
  useEffect(() => {
    void loadTopups();
  }, [topupPage, topupSearch, topupFilter, loadTopups]);

  useEffect(() => { void loadSubscriptions(); }, [loadSubscriptions]);

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
      void loadTopups();
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
        <button className="button button-outline compact-button" type="button" onClick={() => void loadTopups()} disabled={topupsStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {topupsStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load transactions.</span></div>}

      {(topupsStatus === "loading" || topupsStatus === "ready") && <>
        {(() => {
          const rows = topupsStatus === "loading" ? [] : (topups ?? []);
          const pending = rows.filter(t => t.status === "pending").length;
          const completed = rows.filter(t => t.status === "completed").length;
          const canceled = rows.filter(t => t.status === "canceled").length;
          return <div className="usage-grid stats-grid">
            <article className="usage-stat"><strong>{pending}</strong><small><span>Pending (page)</span></small></article>
            <article className="usage-stat"><strong>{completed}</strong><small><span>Completed (page)</span></small></article>
            <article className="usage-stat"><strong>{canceled}</strong><small><span>Canceled (page)</span></small></article>
            <article className="usage-stat"><strong>{pagination?.total ?? 0}</strong><small><span>Total</span></small></article>
          </div>;
        })()}

        {(() => {
          const rows = topupsStatus === "loading" ? [] : (topups ?? []);
          const pageCount = pagination?.totalPages ?? 1;
          const page = topupPage;
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
                <thead><tr><th style={{ whiteSpace: "nowrap" }}>EMAIL</th><th style={{ whiteSpace: "nowrap" }}>ORDER ID</th><th style={{ whiteSpace: "nowrap" }}>CURRENCY</th><th style={{ whiteSpace: "nowrap" }}>AMOUNT</th><th style={{ whiteSpace: "nowrap" }}>CREDITS</th><th style={{ whiteSpace: "nowrap" }}>STATUS</th><th style={{ whiteSpace: "nowrap" }}>KIND</th><th style={{ whiteSpace: "nowrap" }}>CREATED</th><th style={{ whiteSpace: "nowrap" }}>ACTIONS</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="cell-num" style={{ textAlign: "center", padding: "20px" }}>{topupsStatus === "loading" ? <Loader2 size={20} className="spin"/> : topupSearch ? "No matches." : "No transactions yet."}</td></tr>}
                  {rows.map(t => <tr key={t.id}>
                    <td>{t.email}</td>
                    <td className="cell-num">{t.gatewayOrderId ?? "—"}</td>
                    <td>{t.currency}</td>
                    <td className="cell-num">{t.currency === "IDR" ? formatRupiah(Number(t.amountCurrency)) : formatCounter(Number(t.amountCurrency))}</td>
                    <td className="cell-num">{formatCounter(Number(t.creditsAmount))}</td>
                    <td><span className={`status-pill status-${t.status}`}>{t.status}</span></td>
                    <td>{t.kind ?? "—"}</td>
                    <td className="cell-num">{new Date(t.createdAt).toLocaleString("en-GB")}</td>
                    <td>
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
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {pagination && pagination.totalPages > 1 && <div className="pagination">
              <span className="pagination-summary">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}</span>
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
    </section>

    {/* Section 01: Package subscriptions across all users. */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Package subscriptions</h2><p>All active and past package subscriptions, newest first.</p></div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button button-outline compact-button" type="button" onClick={() => void doSweep()} disabled={sweeping}>
            {sweeping ? <><Loader2 size={15} className="row-spinner"/> Sweeping…</> : <><AlertTriangle size={15}/> Sweep expired</>}
          </button>
          <button className="button button-outline compact-button" type="button" onClick={() => void loadSubscriptions()} disabled={subsStatus === "loading"}>
            <RefreshCw size={15}/> Refresh
          </button>
        </div>
      </div>

      {subsStatus === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading subscriptions…</span></div>}
      {subsStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load subscriptions.</span></div>}

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
          const filtered = (subFilter === "all" ? subscriptions : subscriptions.filter(s => s.status === subFilter)).filter(s =>
            q === "" ||
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
    </section>

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
              <tr><td><strong>Amount</strong></td><td className="cell-num">{overrideTarget.currency === "IDR" ? formatRupiah(Number(overrideTarget.amountCurrency)) : formatCounter(Number(overrideTarget.amountCurrency))}</td></tr>
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
