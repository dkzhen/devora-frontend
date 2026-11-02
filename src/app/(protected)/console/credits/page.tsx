"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Gift, Loader2, Plus, QrCode, RefreshCw, Wallet, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { formatCredits, formatCharge, formatRupiah } from "@/lib/credits";
import { TopupDialog, type Topup } from "@/components/topup-dialog";

/**
 * Credits page.
 *
 * The balance here is the same figure the sidebar shows, from the same endpoint
 * (`/api/v1/users/me`) — the two used to disagree because this page hardcoded `0` while
 * the sidebar read the database. One source means they cannot drift again.
 */
type Entry = {
  id: string;
  title: string;
  detail: string;
  date: string;
  /** Signed movement in credits, exact decimal string. */
  amount: string;
  /** The balance immediately after this movement, also exact. */
  balanceAfter: string;
  /** Machine token for the cause — drives the label and the tone. */
  kind: string;
  /** Quotable id, e.g. ADMIN-TOPUP-261011-A1B2C3. This is what a ticket cites. */
  ref: string;
};

type LedgerResult = { data: Entry[]; total: number; totalPages: number; page: number };
type Pagination = { page: number; limit: number; total: number; totalPages: number };

type Status = "loading" | "ready" | "error";

/**
 * A purchase, as `GET /api/v1/topups` reports it.
 *
 * Separate from the ledger on purpose: the ledger answers "where did my balance go" and this
 * answers "what did I pay for". An order that was created and never paid leaves no ledger entry
 * at all, so a history built from the ledger alone would silently hide abandoned checkouts.
 */
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
  gateway: string | null;
  /** The server's verdict on the deadline, so the row does not rely on the reader's clock. */
  expired: boolean;
  createdAt: string;
  completedAt: string | null;
};

/**
 * Two words for one stored status.
 *
 * `canceled` is what the database holds, but it means two different things to the person reading:
 * a code that ran out of time (they did nothing wrong, they can just try again) and an order that
 * was refused at the credit step. The row shows the honest one; the column still stores one word,
 * because a second terminal value would only be a second spelling of one state.
 */
const TOPUP_STATUS: Record<TopupRow["status"], { label: string; tone: string }> = {
  completed: { label: "PAID", tone: "topup-tag-ok" },
  pending: { label: "AWAITING PAYMENT", tone: "topup-tag-wait" },
  canceled: { label: "CANCELED", tone: "topup-tag-off" },
};

/**
 * Which page buttons to render: a window around the current page, plus the first and last.
 *
 * Rendering one button per page does not survive a list that grows — 135 ledger entries at
 * five per page is 27 buttons, which measured 1010px and overflowed a phone by 723px. This
 * keeps the row a fixed size no matter how long the history gets.
 *
 * Always shows the first and last page so both ends stay one click away, and collapses the
 * rest to a gap marker.
 */
export function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
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
 * A ledger `reason` as a heading a person reads.
 *
 * The stored value is a stable machine token; the label is presentation and lives here, so
 * the two can change independently.
 */
/** A timestamp the way a person scans it, not the raw ISO string from the column. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function titleForKind(kind: string): string {
  switch (kind) {
    case "model_charge": return "Model usage";
    case "model_settle": return "Usage settled";
    case "model_refund": return "Refund";
    case "admin_topup": return "Credits granted";
    case "admin_deduct": return "Credits deducted";
    case "admin_adjust": return "Manual adjustment";
    case "voucher_redeem": return "Voucher redeemed";
    case "topup_settlement": return "QRIS top-up";
    case "ledger_opening": return "Opening balance";
    default: return kind.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  }
}

/**
 * Time left on a pending order, read from the row's own expiry.
 *
 * The same "one clock" rule the stats feed follows: this ticks against `Date.now()` locally and
 * the expiry comes from the row, so the figure belongs to that row rather than to whenever the
 * list happened to be rendered. A settled or canceled row renders nothing.
 */
function Countdown2({ expiresAt }: { expiresAt: string | null }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) { setLeft(null); return; }
    const tick = () => setLeft(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  if (left === null) return null;
  if (left <= 0) return <small className="cell-sub">expired</small>;
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return <small className="cell-sub">expires in {mins}:{String(secs).padStart(2, "0")}</small>;
}

export default function CreditsPage() {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState("0");
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [ledgerResult, setLedgerResult] = useState<LedgerResult | null>(null);
  const [ledgerStatus, setLedgerStatus] = useState<Status>("loading");
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerRefreshKey, setLedgerRefreshKey] = useState(0);
  const [topupOpen, setTopupOpen] = useState(false);
  type TopupResult = { data: TopupRow[]; total: number; totalPages: number; page: number };
  const [topupResult, setTopupResult] = useState<TopupResult | null>(null);
  const [topupStatus, setTopupStatus] = useState<Status>("loading");
  const [topupPage, setTopupPage] = useState(1);
  const [topupRefreshKey, setTopupRefreshKey] = useState(0);
  const [cancelReason, setCancelReason] = useState<{ orderId: string; reason: string } | null>(null);
  /**
   * A top-up resumed from the history table — when the payer taps "Show QR" on a pending row,
   * the dialog opens straight on the existing order instead of asking for a new amount. The
   * dialog's `resumeTopup` prop is what switches it into that mode, so the row's QR is shown
   * rather than a fresh one being minted.
   */
  const [resumedTopup, setResumedTopup] = useState<Topup | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setError("Could not load your balance."); setStatus("error"); return; }
      const data = await res.json() as { user?: { credits?: unknown } };
      setBalance(typeof data.user?.credits === "string" ? data.user.credits : "0");
      setStatus("ready");
    } catch {
      setError("Could not reach the gateway.");
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Credit activity — server-side paginated from /api/v1/ledger.
   *
   * Separate from the balance fetch: an unreachable ledger must not blank the
   * balance, and the two have different refresh cycles.
   */
  useEffect(() => {
    const controller = new AbortController();

    async function loadLedger() {
      setLedgerStatus("loading");
      const params = new URLSearchParams({ page: String(ledgerPage), limit: "10" });

      try {
        const token = await getToken();
        const res = await fetch(`/backend/api/v1/ledger?${params}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) setLedgerStatus("error");
          return;
        }
        const data = await res.json() as { entries?: { id: string; deltaCredits: string; balanceAfter: string; kind: string; ref: string; detail: string; reference: string | null; createdAt: string }[]; pagination?: Pagination };
        if (!controller.signal.aborted) {
          setLedgerResult({
            data: (data.entries ?? []).map(e => ({
              id: e.id,
              title: titleForKind(e.kind),
              detail: e.detail,
              date: e.createdAt,
              amount: e.deltaCredits,
              balanceAfter: e.balanceAfter,
              kind: e.kind,
              ref: e.ref,
            })),
            total: data.pagination?.total ?? 0,
            totalPages: data.pagination?.totalPages ?? 1,
            page: data.pagination?.page ?? ledgerPage,
          });
          setLedgerStatus("ready");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) setLedgerStatus("error");
      }
    }

    void loadLedger();
    return () => controller.abort();
  }, [ledgerPage, getToken, ledgerRefreshKey]);

  /**
   * Top-up history, read separately from the ledger with server-side pagination.
   *
   * Its own request because it is a different question and its own failure: an unreachable
   * top-up list must not blank the balance and the activity table above it.
   */
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setTopupStatus("loading");
      const params = new URLSearchParams({ page: String(topupPage), limit: "10" });

      try {
        const token = await getToken();
        const res = await fetch(`/backend/api/v1/topup-history?${params}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) setTopupStatus("error");
          return;
        }
        const data = await res.json() as { topups?: TopupRow[]; pagination?: Pagination };
        if (!controller.signal.aborted) {
          setTopupResult({
            data: data.topups ?? [],
            total: data.pagination?.total ?? 0,
            totalPages: data.pagination?.totalPages ?? 1,
            page: data.pagination?.page ?? topupPage,
          });
          setTopupStatus("ready");
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (!controller.signal.aborted) setTopupStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [topupPage, getToken, topupRefreshKey]);

  /**
   * Resume a pending top-up: open the dialog straight on the existing order's QR.
   *
   * The history list row does not carry the `qrString` (the list endpoint omits it to keep the
   * payload small), so the single-order poll endpoint is fetched first to get the full order,
   * then the dialog is seeded with it. A failed fetch surfaces an error rather than opening a
   * dialog with a QR-less order, because a QR-less resume is indistinguishable from a broken one.
   */
  const resumeTopup = useCallback(async (t: TopupRow) => {
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/topups/${encodeURIComponent(t.orderId)}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setError("Could not load that order."); return; }
      const data = await res.json() as { topup?: Topup };
      if (!data.topup) { setError("Could not load that order."); return; }
      setResumedTopup(data.topup);
      setTopupOpen(true);
    } catch {
      setError("Could not reach the gateway.");
    }
  }, [getToken]);

  /**
   * Cancel a pending top-up from the history table.
   *
   * Calls the user-facing cancel endpoint, which closes the order at the gateway first and then
   * locally. On success the list is reloaded so the row flips to CANCELED; on failure the error
   * is surfaced inline rather than swallowed, because a half-cancelled order is exactly the
   * state a payer needs to know about.
   */
  const cancelTopup = useCallback(async (orderId: string) => {
    setCancelingId(orderId);
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/topups/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not cancel the top-up.");
        return;
      }
      setError("");
      setCancelTarget(null);
      setTopupRefreshKey(k => k + 1);
    } catch {
      setError("Could not reach the gateway.");
    } finally {
      setCancelingId(null);
    }
  }, [getToken]);

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><Wallet size={14}/> MAIN / CREDITS</div><h1>Credits</h1><p>Track the balance you use across Devora services.</p></div></div>

    <section className="credits-hero">
      <div className="credit-hero-copy">
        <div className="credit-eyebrow"><Gift size={15}/> YOUR BALANCE</div>
        <div className="credit-balance">
          {status === "loading"
            ? <Loader2 size={26} className="row-spinner"/>
            : <>
                {formatCredits(balance)} <span>{Number(balance) === 1 ? "credit" : "credits"}</span>
              </>}
        </div>
        <p>Available for AI Gateway requests</p>
        <button className="button button-ink" type="button" onClick={() => setTopupOpen(true)}>
          Add credits <Plus size={16}/>
        </button>
      </div>
      <div className="credit-graphic">
        <div className="credit-ring ring-one"/><div className="credit-ring ring-two"/>
        <span>{status === "loading" ? "—" : Math.floor(Number(balance)).toLocaleString()}<small>CR</small></span>
        <i className="credit-spark">✳</i>
      </div>
    </section>

    {status === "error" && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{error}</p>}

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Top-up history</h2><p>What you paid over QRIS, and what is still waiting.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => setTopupRefreshKey(k => k + 1)} disabled={topupStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>
      {(() => {
        const rows = topupResult?.data ?? [];
        return <>
          <div className="model-table-wrap">
            <table className="model-table">
              <thead><tr><th>ORDER ID</th><th>CREDITS</th><th>PAID</th><th>STATUS</th><th>DATE</th><th>ACTION</th></tr></thead>
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
                        {t.isSandbox && <small className="cell-sub">test payment</small>}
                      </td>
                      <td className="cell-num">{formatCredits(t.credits)}</td>
                      <td className="cell-num">
                        {formatRupiah(t.totalIdr)}
                        {t.feeIdr > 0 && <small className="cell-sub">{formatRupiah(t.amountIdr)} + {formatRupiah(t.feeIdr)} fee</small>}
                      </td>
                      <td className="cell-status">
                        {t.status === "canceled"
                          ? <button type="button" style={{ cursor: "pointer", border: "none", background: "transparent", color: "#7a2320", fontWeight: 700, fontSize: "11px", letterSpacing: "0.5px" }} title="View cancel reason" onClick={() => setCancelReason({ orderId: t.orderId, reason: t.expired ? "The QR code expired before payment was received." : "The order was canceled." })}>{TOPUP_STATUS[t.status].label}</button>
                          : <span style={{ fontWeight: 700, fontSize: "11px", letterSpacing: "0.5px", color: t.status === "completed" ? "#12b3a4" : "#b8860b" }}>{TOPUP_STATUS[t.status].label}</span>}
                        {t.status === "pending" && <Countdown2 expiresAt={t.expiresAt}/>}
                      </td>
                      <td>{formatWhen(t.createdAt)}</td>
                      <td className="cell-action">
                        {t.status === "pending"
                          ? <div className="row-action-group">
                              <button className="action-card" type="button" title="Show QR"
                                aria-label={`Show QR for ${t.orderId}`}
                                onClick={() => void resumeTopup(t)}>
                                <QrCode size={18}/>
                              </button>
                              <button className="action-card action-card-danger" type="button" title="Cancel order"
                                aria-label={`Cancel order ${t.orderId}`}
                                onClick={() => setCancelTarget(t.orderId)}>
                                <X size={18}/>
                              </button>
                            </div>
                          : <span className="cell-dash">—</span>}
                      </td>
                    </tr>)
                  : <tr><td colSpan={6}><div className="table-empty">
                      {topupStatus === "loading"
                        ? <><Loader2 size={19} className="row-spinner"/><strong>Loading top-ups…</strong></>
                        : topupStatus === "error"
                          ? <><X size={19}/><strong>Could not load top-up history</strong></>
                          : <><QrCode size={19}/><strong>No top-ups yet</strong><p>Add credits with QRIS and the order appears here.</p></>}
                    </div></td></tr>}
              </tbody>
            </table>
          </div>
          {(() => {
            const totalPages = topupResult?.totalPages ?? 1;
            const currentPage = topupResult?.page ?? 1;
            const total = topupResult?.total ?? 0;
            const start = total === 0 ? 0 : (currentPage - 1) * 10 + 1;
            const end = Math.min(currentPage * 10, total);

            return totalPages > 1 ? <div className="pagination">
              <span className="pagination-summary">Showing {start}–{end} of {total}</span>
              <div className="pagination-controls">
                <button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setTopupPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
                {pageWindow(currentPage, totalPages).map((n, i) => n === "gap"
                  ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                  : <button key={n} type="button" className={`page-number ${n === currentPage ? "page-current" : ""}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => setTopupPage(n)}>{n}</button>)}
                <button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setTopupPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={15}/></button>
              </div>
            </div> : null;
          })()}
        </>;
      })()}
      <div className="table-note"><AlertTriangle size={14}/> A QRIS order expires about an hour after it is created; an unpaid order still shows here so an abandoned checkout is visible.</div>
    </section>

    {/* Section 02: Credit activity — every credit movement, server-side paginated. */}
    <section className="console-section activity-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>Credit activity</h2><p>Every credit movement on your account.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => setLedgerRefreshKey(k => k + 1)} disabled={ledgerStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>
      {(() => {
        const rows = ledgerResult?.data ?? [];
        const total = ledgerResult?.total ?? 0;
        const totalPages = ledgerResult?.totalPages ?? 1;
        const currentPage = ledgerResult?.page ?? 1;
        const start = total === 0 ? 0 : (currentPage - 1) * 10 + 1;
        const end = Math.min(currentPage * 10, total);

        return <>
          <div className="model-table-wrap">
            <table className="model-table credit-table">
              <thead><tr><th>DATE</th><th>ACTIVITY</th><th>REFERENCE</th><th>DETAIL</th><th>AMOUNT</th></tr></thead>
              <tbody>
                {rows.length > 0
                  ? rows.map(row => <tr key={row.id}>
                      <td>{formatWhen(row.date)}</td>
                      <td className="cell-activity"><span className={`model-dot ${Number(row.amount) > 0 ? "mint-dot" : "coral-dot"}`}/><strong>{row.title}</strong></td>
                      <td>
                        <code className="cell-num" style={{ cursor: "pointer", userSelect: "all" }} title="Click to copy"
                          onClick={() => {
                            const text = row.ref;
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
                        >{row.ref}</code>
                      </td>
                      <td>{row.detail}<small className="ledger-after">balance {formatCredits(row.balanceAfter)}</small></td>
                      <td className={`credit-amount ${Number(row.amount) > 0 ? "credit-positive" : ""}`}>{formatCharge(row.amount)}</td>
                    </tr>)
                  : <tr><td colSpan={5}><div className="table-empty">
                      {ledgerStatus === "loading"
                        ? <><Loader2 size={19} className="row-spinner"/><strong>Loading activity…</strong><p>Reading your ledger.</p></>
                        : ledgerStatus === "error"
                          ? <><X size={19}/><strong>Could not load activity</strong></>
                          : <><Activity size={19}/><strong>No credit activity yet</strong><p>AI Gateway charges will appear here once requests are billed.</p></>}
                    </div></td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && <div className="pagination">
            <span className="pagination-summary">Showing {start}–{end} of {total}</span>
            <div className="pagination-controls">
              <button type="button" className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setLedgerPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
              {pageWindow(currentPage, totalPages).map((n, i) => n === "gap"
                ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
                : <button key={n} type="button" className={`page-number ${n === currentPage ? "page-current" : ""}`} aria-current={n === currentPage ? "page" : undefined} onClick={() => setLedgerPage(n)}>{n}</button>)}
              <button type="button" className="icon-button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => setLedgerPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={15}/></button>
            </div>
          </div>}

          <div className="table-note"><AlertTriangle size={14}/> Charges are sub-credit for most requests, so amounts are shown to six decimals.</div>
        </>;
      })()}
    </section>

    {/* Paying for credits. The dialog prices the order server-side and polls the gateway for
        settlement, so a completed payment lands in the balance without a page reload. */}
    <TopupDialog
      open={topupOpen}
      onClose={() => { setTopupOpen(false); setResumedTopup(null); }}
      onSettled={() => { void load(); setTopupRefreshKey(k => k + 1); setLedgerRefreshKey(k => k + 1); }}
      onCanceled={() => { setTopupRefreshKey(k => k + 1); }}
      balance={balance}
      resumeTopup={resumedTopup}
    />

    {/* Cancel warning — shown when user clicks X (cancel) on a pending order in the history table. */}
    <Modal
      open={cancelTarget !== null}
      onClose={() => setCancelTarget(null)}
      title="Cancel this payment?"
      subtitle="If you have already paid, your credits will not be added."
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setCancelTarget(null)}>Keep order</button>
        <button className="button button-ink compact-button" type="button" disabled={cancelingId !== null} onClick={() => { if (cancelTarget) void cancelTopup(cancelTarget); }}>
          {cancelingId !== null ? <><Loader2 size={14} className="row-spinner"/> Canceling…</> : "Cancel payment"}
        </button>
      </>}
    >
      <div className="table-note topup-note" style={{ borderColor: "var(--coral)", background: "#fff5f5" }}>
        <AlertTriangle size={14}/>
        <span>Canceling this order while a payment is in progress may result in a race condition where your credits are not credited. Only cancel if you are sure you have not paid.</span>
      </div>
    </Modal>

    {/* Cancel reason popup — shown when user clicks a CANCELED status in the history table. */}
    <Modal
      open={cancelReason !== null}
      onClose={() => setCancelReason(null)}
      title="Order canceled"
      subtitle={cancelReason?.orderId ?? ""}
      footer={<button className="button button-ink compact-button" type="button" onClick={() => setCancelReason(null)}>Close</button>}
    >
      {cancelReason && <p style={{ margin: 0 }}>{cancelReason.reason}</p>}
    </Modal>
  </div>;
}
