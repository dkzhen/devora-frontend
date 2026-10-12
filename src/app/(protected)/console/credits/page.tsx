"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Gift, Loader2, Lock, Plus, Wallet, X } from "lucide-react";
import { formatCredits, formatCharge } from "@/lib/credits";

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

type Status = "loading" | "ready" | "error";

const PAGE_SIZE = 20;

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
export function pageWindow(current: number, total: number, span = 1): (number | "gap")[] {
  // Enough pages to show them all without a gap.
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
    case "ledger_opening": return "Opening balance";
    default: return kind.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  }
}

/**
 * A ledger reference, rendered so it can be read aloud and copied exactly.
 *
 * Monospace and selectable by default — the whole point of the id is that it survives being
 * quoted in a ticket, which uppercase-only or truncated styling defeats.
 */
function RefChip({ value }: { value: string }) {
  return <code className="ref-chip" title={`Reference ${value}`}>{value}</code>;
}

export default function CreditsPage() {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState("0");
  const [activity, setActivity] = useState<Entry[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  /** Rows on the server, which may exceed what was fetched. Paging is sized from this. */
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me?limit=1000", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setError("Could not load your balance."); setStatus("error"); return; }
      const data = await res.json() as {
        user?: { credits?: unknown };
        ledger?: {
          id: string; deltaCredits: string; balanceAfter: string;
          kind: string; ref: string; detail: string; reference: string | null; createdAt: string;
        }[];
        /** The account's true ledger size, independent of how many rows were returned. */
        ledgerTotal?: number;
      };
      setBalance(typeof data.user?.credits === "string" ? data.user.credits : "0");
      // Built from `credit_ledger`, which records every movement on the account in order.
      // An empty list here means the account has genuinely not moved, not that the data is
      // missing — the previous version hardcoded an empty array with that ambiguity.
      const entries = Array.isArray(data.ledger) ? data.ledger : [];
      setActivity(entries.map(e => ({
        id: e.id,
        title: titleForKind(e.kind),
        detail: e.detail,
        date: e.createdAt,
        amount: e.deltaCredits,
        balanceAfter: e.balanceAfter,
        kind: e.kind,
        ref: e.ref,
      })));
      setPage(1);
      setTotal(typeof data.ledgerTotal === "number" ? data.ledgerTotal : entries.length);
      setStatus("ready");
    } catch {
      setError("Could not reach the gateway.");
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => { void load(); }, [load]);

  // Sized from the server's count, not from the fetched slice: if a page is ever short
  // (a lower limit, or a growing ledger), the last pages must still be reachable.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = activity.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        <button className="button button-ink" type="button" disabled aria-disabled="true" title="Top-ups are locked"><Lock size={15}/> Add credits <Plus size={16}/></button>
      </div>
      <div className="credit-graphic">
        <div className="credit-ring ring-one"/><div className="credit-ring ring-two"/>
        <span>{status === "loading" ? "—" : Math.floor(Number(balance)).toLocaleString()}<small>CR</small></span>
        <i className="credit-spark">✳</i>
      </div>
    </section>

    {status === "error" && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{error}</p>}

    <section className="console-section activity-section">
      <div className="section-title-row"><div><span className="section-index">01</span><div><h2>Credit activity</h2><p>Every credit movement on your account.</p></div></div></div>
      <div className="model-table-wrap">
        <table className="model-table credit-table">
          <thead><tr><th>DATE</th><th>ACTIVITY</th><th>REFERENCE</th><th>DETAIL</th><th>AMOUNT</th></tr></thead>
          <tbody>
            {rows.length > 0
              ? rows.map(row => <tr key={row.id}>
                  <td>{formatWhen(row.date)}</td>
                  <td><span className={`model-dot ${Number(row.amount) > 0 ? "mint-dot" : "coral-dot"}`}/><strong>{row.title}</strong></td>
                  <td><RefChip value={row.ref}/></td>
                  <td>{row.detail}<small className="ledger-after">balance {formatCredits(row.balanceAfter)}</small></td>
                  <td className={`credit-amount ${Number(row.amount) > 0 ? "credit-positive" : ""}`}>{formatCharge(row.amount)}</td>
                </tr>)
              : <tr><td colSpan={5}><div className="table-empty">
                  {status === "loading"
                    ? <><Loader2 size={19} className="row-spinner"/><strong>Loading activity…</strong><p>Reading your ledger.</p></>
                    : <><Activity size={19}/><strong>No credit activity yet</strong><p>AI Gateway charges will appear here once requests are billed.</p></>}
                </div></td></tr>}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && <div className="pagination">
        <span className="pagination-summary">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
        <div className="pagination-controls">
          <button type="button" className="icon-button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
          {/* A window, not every page. The ledger grows without bound, and rendering one
              button per page put 27 of them in a row — 1010px of controls on a 390px screen,
              which pushed the layout 723px past the viewport. First and last are always
              reachable; the middle collapses to a gap. */}
          {pageWindow(page, pageCount).map((n, i) => n === "gap"
            ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
            : <button key={n} type="button" className={`page-number ${n === page ? "page-current" : ""}`} aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>)}
          <button type="button" className="icon-button" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}><ChevronRight size={15}/></button>
        </div>
      </div>}

      <div className="table-note"><AlertTriangle size={14}/> Charges are sub-credit for most requests, so amounts are shown to six decimals.</div>
    </section>
  </div>;
}
