"use client";

import { formatCounter } from "@/lib/format-counter";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Activity, AlertTriangle, ChevronLeft, ChevronRight, Coins, Eye, Loader2, RefreshCw, Search, Trash2, Users, X, Zap,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { JsonView } from "@/components/json-view";
import { Select } from "@/components/select";

/**
 * One proxied request, as the admin ledger shows it.
 *
 * `outcome` is computed by the backend so the console does not have to re-derive
 * "was this a failure" from a status code in three different places.
 */
type UsageRow = {
  id: string;
  occurredAt: string;
  userId: string;
  email: string;
  model: string;
  endpoint: string;
  isStream: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  chargedCredits: string;
  statusCode: number;
  outcome: "ok" | "error" | "interrupted";
  interrupted: boolean;
  ttftMs: number | null;
  /** Whether captured bodies exist. The bodies themselves are fetched on demand. */
  hasBody: boolean;
};

/** One request's captured bodies, loaded when a row is opened. */
type RequestBody = {
  requestBody: string | null;
  responseBody: string | null;
  truncated: boolean;
  endpoint: string;
  isStream: boolean;
  statusCode: number;
};

/** One account's all-time totals — from the stored counters, not the ledger below. */
type AccountRollup = {
  userId: string;
  email: string;
  plan: string;
  requests: number;
  errors: number;
  interrupted: number;
  totalTokens: number;
  chargedCredits: string;
  modelCount: number;
  firstRequestAt: string;
  lastRequestAt: string;
  freeTokensUsed: number;
};

/** All-time figures across every account, from the snapshot — unaffected by pruning history. */
type GrandTotals = {
  accounts: number;
  requests: number;
  errors: number;
  interrupted: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  chargedCredits: string;
  models: number;
  firstRequestAt: string | null;
  lastRequestAt: string | null;
};

type Page = {
  totals: GrandTotals;
  /** Pager for the accounts rollup, separate from the request list's own pager. */
  accountsPage: number;
  accountsPerPage: number;
  accountsTotal: number;
  accountsTotalPages: number;
  accounts: AccountRollup[];
  rows: UsageRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  models: string[];
};

type Status = "loading" | "ready" | "error";

/** One active subscription, as returned by the admin subscriptions endpoint. */
type ActiveSubscription = {
  id: string;
  name: string;
  category: "hard_cap" | "unlimited";
  tier: string;
  tokensUsed: number;
  tokenCap: number | null;
  fairUseCap: number | null;
  startedAt: string;
  expiresAt: string | null;
};

/** The account whose plan tag was clicked, plus the subscriptions fetched for it. */
type PlanPopup = {
  userId: string;
  email: string;
};


const formatCount = (n: number): string => n.toLocaleString("en-US");

/** Drop trailing zeros from a credit string: "1.200000" -> "1.2". */
const trimCredits = (value: string): string => {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
};

/** Correct plural, because "1 errors" makes a page read as unfinished. */
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${formatCount(n)} ${n === 1 ? one : many}`;

const trim = (v: string): string => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

const stamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "ok", label: "Succeeded" },
  { value: "error", label: "Failed" },
  { value: "interrupted", label: "Interrupted" },
] as const;

export default function AdminUsagePage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<Page | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  // Filters are held in state and sent to the backend, so a search covers the whole
  // ledger rather than only the page already in memory.
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // `userId` is set by clicking an account above; it is the one filter not exposed as an
  // input, because picking the account by name is the intent.
  const [applied, setApplied] = useState({ search: "", model: "", status: "", userId: "" });
  const [page, setPage] = useState(1);
  // Its own page number. The two lists paginate independently — sharing one would make
  // switching pages above reset the history below, which the operator did not ask for.
  const [accountsPage, setAccountsPage] = useState(1);
  /** Confirmation gate for the bulk delete. A destructive action behind one click is a trap. */
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The row whose bodies are open, and what came back. Fetched per row, not with the list. */
  const [viewing, setViewing] = useState<UsageRow | null>(null);
  const [body, setBody] = useState<RequestBody | null>(null);
  const [bodyStatus, setBodyStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Accounts table search — separate from the request-history search, because the two lists
  // filter different things. `accountSearch` is the input; `appliedAccountSearch` is what was
  // submitted and is actually sent to the API.
  const [accountSearch, setAccountSearch] = useState("");
  const [appliedAccountSearch, setAppliedAccountSearch] = useState("");

  // Plan-tag popup: clicking a SUBSCRIPTION or SUPERUSER plan tag opens a modal showing the
  // user's active subscriptions. Fetched on click, not with the list.
  const [planPopup, setPlanPopup] = useState<PlanPopup | null>(null);
  const [subsData, setSubsData] = useState<ActiveSubscription[] | null>(null);
  const [subsStatus, setSubsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const params = new URLSearchParams({ page: String(page), limit: "50", accountsPage: String(accountsPage) });
      if (applied.search) params.set("search", applied.search);
      if (applied.model) params.set("model", applied.model);
      if (applied.status) params.set("status", applied.status);
      if (applied.userId) params.set("user", applied.userId);
      if (appliedAccountSearch) params.set("accountSearch", appliedAccountSearch);
      const res = await fetch(`/backend/api/v1/admin/usage?${params}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        setError(res.status === 403 ? "This account is not an administrator." : "Could not load usage.");
        setStatus("error");
        return;
      }
      setData(await res.json() as Page);
      setStatus("ready");
    } catch {
      setError("Could not reach the backend.");
      setStatus("error");
    }
  }, [getToken, page, accountsPage, applied, appliedAccountSearch]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Clear the request log.
   *
   * Only the ledger is removed. The tiles above read from the stored snapshot, so they do not
   * change — which is the whole reason the two are kept apart, and why this is safe to offer
   * as a button rather than a migration.
   */
  const clearLogs = async () => {
    setClearing(true);
    setNotice(null);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/usage/logs", {
        method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const body = await res.json().catch(() => null) as { removed?: number; error?: { message?: string } } | null;
      if (!res.ok) { setNotice(body?.error?.message ?? "Could not clear the logs."); return; }
      setNotice(`Cleared ${formatCount(body?.removed ?? 0)} request log row(s). Totals unchanged.`);
      setConfirmClear(false);
      setPage(1);
      await load();
    } catch {
      setNotice("Could not reach the backend.");
    } finally {
      setClearing(false);
    }
  };

  /** Open a row's bodies. The list never carries them, so this is where they are fetched. */
  const openBody = async (row: UsageRow) => {
    setViewing(row);
    setBody(null);
    setBodyStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/admin/usage/${row.id}/body`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setBodyStatus("error"); return; }
      setBody(await res.json() as RequestBody);
      setBodyStatus("ready");
    } catch {
      setBodyStatus("error");
    }
  };

  const apply = () => {
    setPage(1);
    setApplied({ search: search.trim(), model: modelFilter, status: statusFilter, userId: "" });
  };

  /** Apply the accounts search — resets to page 1 and sends the search to the backend. */
  const applyAccountSearch = () => {
    setAccountsPage(1);
    setAppliedAccountSearch(accountSearch.trim());
  };

  /** Clear the accounts search. */
  const clearAccountSearch = () => {
    setAccountSearch("");
    setAccountsPage(1);
    setAppliedAccountSearch("");
  };

  /** Open the plan-tag popup for a user, fetching their active subscriptions. */
  const openPlanPopup = async (userId: string, email: string) => {
    setPlanPopup({ userId, email });
    setSubsData(null);
    setSubsStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/admin/users/${userId}/subscriptions`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setSubsStatus("error"); return; }
      const body = await res.json() as { subscriptions: ActiveSubscription[] };
      setSubsData(body.subscriptions);
      setSubsStatus("ready");
    } catch {
      setSubsStatus("error");
    }
  };

  /** Clear every filter, including an account picked from the table above. */
  const clear = () => {
    setSearch("");
    setModelFilter("");
    setStatusFilter("");
    setPage(1);
    setApplied({ search: "", model: "", status: "", userId: "" });
    setAccountSearch("");
    setAppliedAccountSearch("");
    setAccountsPage(1);
  };

  const filtersActive = applied.search !== "" || applied.model !== "" || applied.status !== "";
  const rangeFrom = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const rangeTo = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="small-eyebrow"><Zap size={11}/> GATEWAY LEDGER</span>
          <h1>Usage</h1>
          <p>Every request through the gateway, across all accounts.</p>
        </div>
        <button className="button button-outline compact-button" onClick={() => void load()} disabled={status === "loading"}><RefreshCw size={14}/> Refresh</button>
      </div>

      <section className="console-section stats-section">
        <div className="section-title-row">
          <div>
            <span className="section-index">00</span>
            <div><h2>All-time totals</h2><p>Totals across every account. Read from a stored snapshot, so clearing request history does not change them.</p></div>
          </div>
        </div>
        {status === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading totals…</span></div>}
        {status === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>{error}</span></div>}
        {status === "ready" && data && <div className="usage-grid stats-grid">
          <article className="usage-stat">
            <div className="stat-top"><span>Requests</span><Activity size={16}/></div>
            <strong>{formatCount(data.totals.requests)}</strong>
            <small>{data.totals.errors > 0 || data.totals.interrupted > 0
              ? `${plural(data.totals.errors, "error")}${data.totals.interrupted > 0 ? `, ${plural(data.totals.interrupted, "interrupted")}` : ""}`
              : "all served"}</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Tokens</span><Zap size={16}/></div>
            <strong>{formatCounter(data.totals.totalTokens)}</strong>
            <small>{formatCounter(data.totals.promptTokens)} in · {formatCounter(data.totals.completionTokens)} out</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Credits used</span><Coins size={16}/></div>
            <strong>{formatCounter(Number(data.totals.chargedCredits))}</strong>
            <small>{data.totals.lastRequestAt ? `last used ${stamp(data.totals.lastRequestAt)}` : "never used"}</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Accounts</span><Users size={16}/></div>
            <strong>{formatCount(data.totals.accounts)}</strong>
            <small>{plural(data.totals.models, "model")} in use</small>
          </article>
        </div>}
      </section>

      <section className="console-section">
        <div className="section-title-row">
          <div>
            <span className="section-index">01</span>
            <div><h2>Accounts</h2><p>All-time totals per account, newest activity first.</p></div>
          </div>
        </div>
        {status === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/><span>Loading accounts…</span></div>}
        {status === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/><span>{error}</span></div>}
        {status === "ready" && data && <>
        <div className="users-toolbar">
          <label className="search-field">
            <Search size={14}/>
            <input
              value={accountSearch}
              onChange={e => setAccountSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applyAccountSearch(); }}
              placeholder="Search by email…"
              aria-label="Search accounts by email"
            />
          </label>
          <button className="button compact-button" onClick={applyAccountSearch}>Search</button>
          {appliedAccountSearch && <button className="button button-outline compact-button" onClick={clearAccountSearch}><X size={13}/> Clear</button>}
        </div>
        {data.accounts.length === 0
          ? <div className="table-empty"><Zap size={22}/><strong>No usage yet</strong><p>{appliedAccountSearch ? "No accounts match this search." : "Nothing has gone through the gateway."}</p></div>
          : <div className="model-table-wrap"><table className="model-table usage-table accounts-table">
              <thead><tr><th style={{whiteSpace:"nowrap"}}>Account</th><th style={{whiteSpace:"nowrap"}}>Plan</th><th style={{whiteSpace:"nowrap"}}>Requests</th><th style={{whiteSpace:"nowrap"}}>Tokens</th><th style={{whiteSpace:"nowrap"}}>Free tokens</th><th style={{whiteSpace:"nowrap"}}>Credits</th><th style={{whiteSpace:"nowrap"}}>Last used</th></tr></thead>
              <tbody>
                {data.accounts.map(a => (
                  <tr key={a.userId} className={applied.userId === a.userId ? "row-selected" : undefined}>
                    <td><button className="account-link" onClick={() => { const same = applied.userId === a.userId; setSearch(same ? "" : a.email); setPage(1); setApplied({ ...applied, userId: same ? "" : a.userId, search: same ? "" : a.email }); }}>{a.email}</button></td>
                    <td>
                      {(a.plan === "SUBSCRIPTION" || a.plan === "SUPERUSER")
                        ? <button className={`plan-tag plan-${a.plan.toLowerCase()} plan-tag-clickable`} type="button" title="View active subscriptions" onClick={() => void openPlanPopup(a.userId, a.email)}>{a.plan}</button>
                        : <span className={`plan-tag plan-${a.plan.toLowerCase()}`}>{a.plan}</span>}
                    </td>
                    <td className="cell-num">{formatCount(a.requests)}{a.errors > 0 && <span className="cell-sub">{a.errors} failed</span>}</td>
                    <td className="cell-num">{formatCounter(a.totalTokens)}</td>
                    <td className="cell-num">{formatCounter(a.freeTokensUsed)}/{formatCounter(20_000_000)}</td>
                    <td className="cell-num">{formatCounter(Number(a.chargedCredits))}</td>
                    <td className="cell-muted">{stamp(a.lastRequestAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>}
        </>}

        {/* The pager sits outside the ready/empty branches so it also shows on an empty
            page — otherwise landing past the last page would strand the operator with no
            way back. */}
        {status === "ready" && data && data.accountsTotal > 0 && (
          <div className="pagination">
            <span className="pagination-summary">
              {formatCount((data.accountsPage - 1) * data.accountsPerPage + 1)}–{formatCount(Math.min(data.accountsPage * data.accountsPerPage, data.accountsTotal))} of {formatCount(data.accountsTotal)}
            </span>
            <div className="pagination-controls">
              <button className="icon-button" onClick={() => setAccountsPage(p => Math.max(p - 1, 1))} disabled={data.accountsPage <= 1} aria-label="Previous accounts page"><ChevronLeft size={15}/></button>
              <span className="page-number page-current">{data.accountsPage}</span>
              <button className="icon-button" onClick={() => setAccountsPage(p => Math.min(p + 1, data.accountsTotalPages))} disabled={data.accountsPage >= data.accountsTotalPages} aria-label="Next accounts page"><ChevronRight size={15}/></button>
            </div>
          </div>
        )}
      </section>

      <section className="console-section">
        <div className="section-title-row">
          <div>
            <span className="section-index">02</span>
            <div><h2>Requests</h2><p>Newest first. Filter by account, model, or outcome.</p></div>
          </div>
          <button className="button button-outline compact-button" type="button" onClick={() => setConfirmClear(true)} disabled={status !== "ready" || (data?.total ?? 0) === 0}>
            <Trash2 size={14}/> Clear logs
          </button>
        </div>
        {notice && <p className="voucher-message voucher-ok" role="status">{notice}</p>}
        {applied.userId !== "" && <div className="filter-note">Showing one account. <button className="row-retry" onClick={clear}>Show all</button></div>}

        <div className="users-toolbar">
          <label className="search-field">
            <Search size={14}/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") apply(); }}
              placeholder="Search email or model…"
              aria-label="Search usage"
            />
          </label>
          <Select
            label="Filter by model"
            value={modelFilter}
            onChange={setModelFilter}
            placeholder="All models"
            width={190}
            options={[
              { value: "", label: "All models" },
              ...(data?.models ?? []).map(m => ({ value: m, label: m.replace(/^devora-01\//, "") })),
            ]}
          />
          <Select
            label="Filter by outcome"
            value={statusFilter}
            onChange={setStatusFilter}
            width={150}
            options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label }))}
          />
          <button className="button compact-button" onClick={apply} disabled={status === "loading"}>Apply</button>
          {filtersActive && <button className="button button-outline compact-button" onClick={clear}><X size={13}/> Clear</button>}
        </div>

        {status === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/><span>Loading usage…</span></div>}
        {status === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/><span>{error}</span></div>}

        {status === "ready" && data && <>
          {data.rows.length === 0
            ? <div className="table-empty"><Zap size={22}/><strong>No requests</strong><p>{filtersActive ? "No requests match these filters." : "Nothing has gone through the gateway yet."}</p></div>
            : <>
              <div className="model-table-wrap">
                <table className="model-table usage-table">
                  <thead>
                    <tr>
                      <th style={{whiteSpace:"nowrap"}}>When</th><th style={{whiteSpace:"nowrap"}}>Account</th><th style={{whiteSpace:"nowrap"}}>Model</th><th style={{whiteSpace:"nowrap"}}>Tokens</th><th style={{whiteSpace:"nowrap"}}>Credits</th><th style={{whiteSpace:"nowrap"}}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(row => (
                      <tr
                        key={row.id}
                        className={row.hasBody ? "usage-row-openable" : undefined}
                        onClick={row.hasBody ? () => void openBody(row) : undefined}
                        title={row.hasBody ? "View request and response" : undefined}
                      >
                        <td>{stamp(row.occurredAt)}</td>
                        <td><span className="usage-email" title={row.email}>{row.email}</span></td>
                        <td>
                          <code title={row.model}>{row.model.replace(/^devora-01\//, "")}</code>
                          {row.isStream && <span className="cell-sub">stream{row.ttftMs !== null ? ` · ${row.ttftMs}ms ttft` : ""}</span>}
                        </td>
                        <td className="cell-num">
                          {formatCounter(row.totalTokens)}
                          <span className="cell-sub">{formatCounter(row.promptTokens)} in · {formatCounter(row.completionTokens)} out</span>
                        </td>
                        <td className="cell-num">{trimCredits(row.chargedCredits)}</td>
                        <td>
                          <span className={`outcome-pill outcome-${row.outcome}`}>{row.outcome === "ok" ? `${row.statusCode}` : row.outcome === "interrupted" ? "stopped" : `${row.statusCode}`}</span>
                          {row.hasBody && <span className="row-view-hint"><Eye size={11}/> view</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span className="pagination-summary">{formatCount(rangeFrom)}–{formatCount(rangeTo)} of {formatCount(data.total)}</span>
                <div className="pagination-controls">
                  <button className="icon-button" onClick={() => setPage(p => Math.max(p - 1, 1))} disabled={data.page <= 1} aria-label="Previous page"><ChevronLeft size={15}/></button>
                  <span className="page-number page-current">{data.page}</span>
                  <button className="icon-button" onClick={() => setPage(p => Math.min(p + 1, data.totalPages))} disabled={data.page >= data.totalPages} aria-label="Next page"><ChevronRight size={15}/></button>
                </div>
              </div>
            </>}
        </>}
      </section>
      {/* The bodies, side by side on a wide screen and stacked on a narrow one. A modal rather
          than an expanding row: a body is tall, and pushing every row below it down is
          disorienting when the point is to compare one request against the list. */}
      <Modal
        open={viewing !== null}
        title="Request detail"
        subtitle={viewing ? `${viewing.email} · ${viewing.model.replace(/^devora-01\//, "")} · ${stamp(viewing.occurredAt)}` : ""}
        wide
        onClose={() => setViewing(null)}
        footer={<button className="button button-outline compact-button" type="button" onClick={() => setViewing(null)}>Close</button>}
      >
        {bodyStatus === "loading" && <div className="usage-loading"><Loader2 size={16} className="spin"/> Loading bodies…</div>}
        {bodyStatus === "error" && <p className="success-line row-fail" role="status"><AlertTriangle size={14}/> Could not load the request bodies.</p>}
        {bodyStatus === "ready" && body && (
          <>
            {body.truncated && <p className="body-note"><AlertTriangle size={13}/> Body was longer than the capture cap and is stored truncated.</p>}
            <div className="body-grid">
              <JsonView label={body.requestBody ? "Request" : "Request (none captured)"} source={body.requestBody ?? "{}"}/>
              <JsonView label="Response" source={body.responseBody ?? "{}"}/>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={confirmClear}
        tone="danger"
        title="Clear request logs"
        subtitle="Removes the per-request history. This cannot be undone."
        busy={clearing}
        onClose={() => setConfirmClear(false)}
        footer={<>
          <button className="button button-outline compact-button" type="button" onClick={() => setConfirmClear(false)} disabled={clearing}>Cancel</button>
          <button className="button button-ink compact-button" type="button" onClick={() => void clearLogs()} disabled={clearing}>
            {clearing ? <><Loader2 size={13} className="row-spinner"/> Clearing…</> : "Clear logs"}
          </button>
        </>}
      >
        <div className="modal-danger-note"><AlertTriangle size={15}/>
          <span>Deletes <strong>{formatCount(data?.total ?? 0)}</strong> request log row(s) — the individual requests, their timestamps, tokens and charges.</span>
        </div>
        {/* The distinction that matters, stated plainly: an operator about to press a red
            button should not have to remember which figures survive. */}
        <div className="modal-subject">
          <strong>These are not affected</strong>
          <small>All-time totals stay: <span className="modal-balance">{formatCount(data?.totals.requests ?? 0)} requests</span> across {formatCount(data?.totals.accounts ?? 0)} account(s). They are read from a snapshot, not from these logs.</small>
        </div>
      </Modal>

      <Modal
        open={planPopup !== null}
        title="Active subscriptions"
        subtitle={planPopup ? planPopup.email : ""}
        onClose={() => { setPlanPopup(null); setSubsData(null); setSubsStatus("idle"); }}
        footer={<button className="button button-outline compact-button" type="button" onClick={() => { setPlanPopup(null); setSubsData(null); setSubsStatus("idle"); }}>Close</button>}
      >
        {subsStatus === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/><span>Loading subscriptions…</span></div>}
        {subsStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/><span>Could not load subscriptions.</span></div>}
        {subsStatus === "ready" && subsData && (
          subsData.length === 0
            ? <div className="table-empty"><Zap size={22}/><strong>No active subscriptions</strong><p>This account has no live package subscriptions.</p></div>
            : <div className="model-table-wrap"><table className="model-table">
                <thead><tr>
                  <th style={{whiteSpace:"nowrap",textAlign:"left"}}>Package</th>
                  <th style={{whiteSpace:"nowrap",textAlign:"left"}}>Category</th>
                  <th style={{whiteSpace:"nowrap",textAlign:"left"}}>Token used</th>
                  <th style={{whiteSpace:"nowrap",textAlign:"left"}}>Token cap</th>
                  <th style={{whiteSpace:"nowrap",textAlign:"left"}}>Expires at</th>
                </tr></thead>
                <tbody>
                  {subsData.map(s => (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong></td>
                      <td><span className={`outcome-pill outcome-${s.category === "hard_cap" ? "ok" : "interrupted"}`}>{s.category === "hard_cap" ? "hard cap" : "unlimited"}</span></td>
                      <td>{formatCounter(s.tokensUsed)}</td>
                      <td>
                        {s.category === "hard_cap"
                          ? (s.tokenCap !== null ? formatCounter(s.tokenCap) : "—")
                          : (s.fairUseCap !== null ? `${formatCounter(s.fairUseCap)} (fair use)` : "Unlimited")}
                      </td>
                      <td className="cell-muted">{s.expiresAt ? stamp(s.expiresAt) : "Lifetime"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
        )}
      </Modal>
    </div>
  );
}
