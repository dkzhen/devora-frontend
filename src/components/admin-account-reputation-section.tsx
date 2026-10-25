"use client";

/**
 * Account reputation — the usage side of the abuse picture.
 *
 * The signup section answers "who registered here". This one answers "how is
 * the account being used": whether one API key is being shared across many
 * addresses, and whether an address is being shared across many accounts.
 *
 * Both questions are answered with observations, not verdicts. Nothing in this
 * component enforces anything — the only action is clearing ONE account, which
 * is a human decision recorded against that account alone.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Fingerprint, Loader2, RefreshCw, ShieldCheck, Undo2, Users } from "lucide-react";
import { Pager } from "@/components/pager";

type Tier = "good" | "warning" | "bad";

type ReputationAccount = {
  userId: string;
  email: string;
  plan: string;
  status: string;
  reputationScore: number;
  reputationTier: Tier;
  distinctIpCount: number;
  sharedIpCount: number;
  apiKeyCount: number;
  requestCount: number;
  signupIp: string | null;
  lastIp: string | null;
  lastSeenAt: string | null;
  reasons: string[];
};

type Summary = { total: number; good: number; warning: number; bad: number; unassessed?: number };
type Report = {
  accounts: ReputationAccount[];
  summary: Summary;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

/** Accounts per page. A reputation row is dense, so the page is short. */
const PAGE_SIZE = 15;
type Status = "loading" | "ready" | "error";

const formatCount = (n: number): string => n.toLocaleString("en-US");

const stamp = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** The tier as a pill class. Good is quiet, bad is the coral the console uses for trouble. */
const tierClass = (tier: Tier): string =>
  tier === "bad" ? "outcome-error" : tier === "warning" ? "outcome-interrupted" : "outcome-ok";

export function AdminAccountReputationSection() {
  const { getToken } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);

  const [page, setPage] = useState(1);

  // `load` takes the page to fetch and does not read the page state, so it is
  // stable across renders and cannot re-trigger itself.
  const load = useCallback(async (pageNo: number) => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/admin/users/reputation?page=${pageNo}&limit=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        setError(res.status === 401 || res.status === 404
          ? "This account is not an administrator."
          : "Could not load account reputation.");
        setStatus("error");
        return;
      }
      const data = await res.json() as Report;
      setReport({
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        summary: data.summary ?? { total: 0, good: 0, warning: 0, bad: 0 },
        page: Number(data.page ?? pageNo),
        perPage: Number(data.perPage ?? PAGE_SIZE),
        total: Number(data.total ?? 0),
        totalPages: Number(data.totalPages ?? 1),
      });
      setPage(Number(data.page ?? pageNo));
      setStatus("ready");
    } catch {
      setError("Could not reach the backend.");
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => { void load(1); }, [load]);

  const recompute = async () => {
    setNotice(null);
    setRecomputing(true);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/reputation/recompute", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const body = await res.json().catch(() => null) as { recomputed?: number; error?: { message?: string } } | null;
      if (!res.ok) {
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not recompute." });
        return;
      }
      setNotice({ kind: "ok", text: `${body?.recomputed ?? 0} account(s) recomputed.` });
      await load(page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the backend." });
    } finally {
      setRecomputing(false);
    }
  };

  const clear = async (row: ReputationAccount) => {
    setNotice(null);
    setBusyId(row.userId);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/reputation/clear", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId }),
      });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not clear the reputation." });
        return;
      }
      setNotice({ kind: "ok", text: `${row.email} cleared to good.` });
      await load(page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the backend." });
    } finally {
      setBusyId(null);
    }
  };

  const accounts = report?.accounts ?? [];
  const summary = report?.summary ?? { total: 0, good: 0, warning: 0, bad: 0 };

  return <section className="admin-signup-risk-section">
    <div className="section-title-row">
      <div>
        <span className="section-index">04</span>
        <div>
          <h2>Gateway usage reputation</h2>
          <p>API-key usage only: request IPs, shared addresses and key spread. Signup risk is shown above.</p>
        </div>
      </div>
      <div className="reputation-actions">
        <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => void recompute()}
          disabled={recomputing || status === "loading"}
        >
          {recomputing ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} Recompute
        </button>
        <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => void load(page)}
          disabled={status === "loading"}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
    </div>

    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status">
      <ShieldCheck size={14} />{notice.text}
    </p>}
    {status === "loading" && <div className="usage-loading"><Loader2 size={16} className="spin" /> Loading account reputation…</div>}
    {status === "error" && <p className="success-line row-fail" role="status"><AlertTriangle size={14} /> {error}</p>}

    {status === "ready" && <>
      <div className="usage-grid stats-grid">
        <article className="usage-stat">
          <div className="stat-top"><span>Accounts</span><Users size={16} /></div>
          <strong>{formatCount(summary.total)}</strong>
          <small>assessed at the gateway</small>
        </article>
        <article className="usage-stat">
          <div className="stat-top"><span>Good</span><ShieldCheck size={16} /></div>
          <strong>{formatCount(summary.good)}</strong>
          <small>one account, one address</small>
        </article>
        <article className="usage-stat">
          <div className="stat-top"><span>Not assessed</span><Users size={16} /></div>
          <strong>{formatCount(summary.unassessed ?? 0)}</strong>
          <small>no gateway request yet</small>
        </article>
        <article className="usage-stat">
          <div className="stat-top"><span>Needs attention</span><Fingerprint size={16} /></div>
          <strong>{formatCount(summary.warning + summary.bad)}</strong>
          <small>{formatCount(summary.bad)} bad, {formatCount(summary.warning)} warning</small>
        </article>
      </div>

      <div className="admin-risk-subsection">
        <div className="section-title-row">
          <div><div><h3>Reputation by account</h3><p>Worst first. A score is an observation, not a penalty.</p></div></div>
        </div>
        {accounts.length === 0
          ? <div className="model-table-wrap"><table className="model-table"><thead><tr>
              <th>Account</th><th>Score</th><th>Tier</th><th>Addresses</th><th>Shared</th><th>Requests</th><th>Last seen</th><th></th>
            </tr></thead><tbody><tr><td colSpan={8}>
              <div className="table-empty"><Users size={20} /><strong>No gateway traffic yet</strong><p>This score comes from API requests made with a Devora key — not from signup. Accounts without traffic are shown as not assessed.</p></div>
            </td></tr></tbody></table></div>
          : <div className="model-table-wrap"><table className="model-table">
              <thead><tr>
                <th>Account</th><th>Score</th><th>Tier</th><th>Addresses</th><th>Shared</th><th>Requests</th><th>Last seen</th><th></th>
              </tr></thead>
              <tbody>{accounts.map(row => (
                <tr key={row.userId}>
                  <td>
                    <strong>{row.email}</strong>
                    <span className="cell-sub">{row.reasons[0] ?? "No observation recorded"}</span>
                  </td>
                  <td className="cell-num">{row.reputationScore}</td>
                  <td>{row.requestCount === 0
                    ? <span className="outcome-pill outcome-muted" title="No gateway request has been recorded for this account yet">not assessed</span>
                    : <span className={`outcome-pill ${tierClass(row.reputationTier)}`}>{row.reputationTier}</span>}</td>
                  <td className="cell-num">{formatCount(row.distinctIpCount)}</td>
                  <td className="cell-num">{row.sharedIpCount > 0
                    ? <span className="outcome-pill outcome-interrupted">{formatCount(row.sharedIpCount)}</span>
                    : "0"}</td>
                  <td className="cell-num">{formatCount(row.requestCount)}</td>
                  <td className="cell-muted">{stamp(row.lastSeenAt)}</td>
                  <td>
                    <button
                      className="row-action"
                      type="button"
                      title="Clear this account's reputation"
                      aria-label={`Clear the reputation for ${row.email}`}
                      onClick={() => void clear(row)}
                      disabled={busyId === row.userId || row.reputationScore === 0}
                    >
                      {busyId === row.userId ? <Loader2 size={14} className="row-spinner" /> : <Undo2 size={14} />}
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>}
        <Pager
          page={report?.page ?? 1}
          perPage={report?.perPage ?? PAGE_SIZE}
          total={report?.total ?? 0}
          totalPages={report?.totalPages ?? 1}
          onPage={pageNo => void load(pageNo)}
          busy={false}
        />
      </div>
    </>}

    <div className="table-note">
      <AlertTriangle size={13} /> Reputation is an observation. Clearing an account restores its allowance; it never touches another account.
    </div>
  </section>;
}
