"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle, Check, Coins, Loader2, RefreshCw, Search, ShieldCheck, Trash2, UserCog, Users, X, ChevronLeft, ChevronRight} from "lucide-react";
import { Select } from "@/components/select";
import { formatCredits } from "@/lib/credits";
import { formatCounter } from "@/lib/format-counter";
import { Modal } from "@/components/modal";

const ALL_PLANS = ["STANDARD", "SUBSCRIPTION", "SUPERUSER"] as const;
type Plan = (typeof ALL_PLANS)[number];

type AccountRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  plan: string;
  status: string;
  /** Exact decimal string from numeric(18,6). */
  credits: string;
  createdAt: string;
  updatedAt: string;
  keyCount: number;
};

type Status = "loading" | "ready" | "error";

/** Thousands separators, because these figures are read at a glance. */
const formatCount = (n: number): string => n.toLocaleString("en-US");


const shortDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

export default function AdminUsersPage() {
  const { getToken } = useAuth();
  const [users, setUsers] = useState<AccountRow[]>([]);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters live in state and are sent to the backend, so the search is over all
  // accounts rather than only the page already loaded.
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "">("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sortBy, setSortBy] = useState<"created" | "credits">("created");
  // Its own pager state. Filters reset it because a narrowed list has fewer pages, and
  // staying on page 7 of a 1-page result would render an empty table.
  const [page, setPage] = useState(1);
  const [pager, setPager] = useState({ total: 0, perPage: 25, totalPages: 1 });

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
  }, [getToken]);

  const load = useCallback(async (term: string, plan: Plan | "", pageNo = 1, sort: "created" | "credits" = "created") => {
    setStatus("loading");
    try {
      const params = new URLSearchParams({ page: String(pageNo), limit: "25" });
      if (term.trim()) params.set("search", term.trim());
      if (plan) params.set("plan", plan);
      if (sort === "credits") params.set("sort", "credits");
      const qs = params.toString();
      const res = await fetch(`/backend/api/v1/admin/users?${qs}`, { headers: await authHeaders() });
      if (!res.ok) { setError("Could not load accounts."); setStatus("error"); return; }
      const data = await res.json() as {
        users?: unknown; actorUserId?: string;
        page?: number; perPage?: number; total?: number; totalPages?: number;
        synced?: { imported: number; total: number } | null;
      };
      const rows = Array.isArray(data.users) ? data.users as AccountRow[] : [];
      setUsers(rows.map(row => ({
        ...row,
        keyCount: Number(row.keyCount ?? 0),
        credits: String(row.credits ?? "0"),
        status: String(row.status ?? "ACTIVE"),
      })));
      setActorUserId(data.actorUserId ?? null);
      const total = Number(data.total ?? 0);
      const perPage = Number(data.perPage ?? 25);
      const totalPages = Number(data.totalPages ?? 1);
      setPager({ total, perPage, totalPages });

      // Landing past the end happens naturally: deleting the last row of the last page
      // leaves the requested page empty. Step back one and refetch rather than showing an
      // empty table, which would read as "there are no accounts" — the opposite of true.
      if (rows.length === 0 && total > 0 && pageNo > totalPages) {
        setPage(totalPages);
        void load(term, plan, totalPages);
        return;
      }
      // Say when the Clerk sync actually brought something in, so a sudden jump in the
      // list is explained rather than surprising.
      if (data.synced && data.synced.imported > 0) {
        setNotice({ kind: "ok", text: `Imported ${data.synced.imported} account(s) from Clerk — ${data.synced.total} registered in total.` });
      }
      setStatus("ready");
    } catch {
      setError("Could not reach the gateway.");
      setStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void load("", "", 1); }, [load]);

  const applySearch = () => { setAppliedSearch(search); setPage(1); void load(search, planFilter, 1, sortBy); };

  /** Confirm a plan change. The dialog sets `dialog`, this performs it. */
  const changePlan = async (row: AccountRow, plan: Plan) => {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/users/${row.id}`, {
        method: "PATCH", headers: await authHeaders(), body: JSON.stringify({ plan }),
      });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not change the plan." }); return; }
      setNotice({ kind: "ok", text: `${row.email} is now ${plan}.` });
      setDialog(null);
      // Stay on the page being viewed: a plan change or a credit top-up should not move
      // the operator back to page 1 and lose their place in the list.
      await load(appliedSearch, planFilter, page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Apply a credit adjustment. The amount arrives as an argument — the dialog validates it
   * before calling, so this only has to perform the write.
   */
  const adjustCredits = async (row: AccountRow, delta: number) => {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/users/${row.id}`, {
        method: "PATCH", headers: await authHeaders(), body: JSON.stringify({ creditsDelta: delta }),
      });
      const body = await res.json().catch(() => null) as { user?: { credits?: number }; error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not adjust credits." }); return; }
      setNotice({ kind: "ok", text: `${row.email} credits ${delta > 0 ? "+" : ""}${delta} → ${body?.user?.credits ?? "?"}.` });
      setDialog(null);
      await load(appliedSearch, planFilter, page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

  /** Perform the deletion. Confirmation is the dialog's job. */
  const remove = async (row: AccountRow) => {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/users/${row.id}`, { method: "DELETE", headers: await authHeaders() });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not delete the account." }); return; }
      setNotice({ kind: "ok", text: `${row.email} deleted.` });
      setDialog(null);
      await load(appliedSearch, planFilter, page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

/**
 * A whole, non-zero credit amount.
 *
 * The backend rejects anything else, so the dialog checks first — a disabled button with the
 * reason beside it beats a round trip that comes back with a 400.
 */
function isValidDelta(raw: string): boolean {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isInteger(n) && n !== 0;
}

/** What the balance becomes if the draft is applied, or why it cannot be. */
function deltaPreview(raw: string, current: string): string {
  if (raw.trim() === "") return "Enter a positive amount to grant, or a negative one to deduct.";
  if (!isValidDelta(raw)) return "Must be a whole number, and not zero.";
  const next = Number(current) + Number(raw);
  // Floored at zero by the backend, so the preview says so rather than showing a negative.
  return next < 0
    ? `${formatCredits(current)} + ${raw} floors at 0 (a deduction cannot create debt).`
    : `${formatCredits(current)} → ${next.toFixed(6)}`;
}

  const isSelf = (row: AccountRow) => actorUserId !== null && row.id === actorUserId;

  /**
   * Which dialog is open, and for whom.
   *
   * One piece of state rather than three booleans: only one dialog can be open at a time, and
   * a discriminated union makes that impossible to violate instead of merely unlikely. The
   * row is carried in the state so each dialog renders the account it was opened for.
   */
  const [dialog, setDialog] = useState<
    | { kind: "credits"; row: AccountRow }
    | { kind: "plan"; row: AccountRow; plan: Plan }
    | { kind: "delete"; row: AccountRow }
    | null
  >(null);
  /** Draft value for the credits field. Kept separate from the row so typing never mutates it. */
  const [creditDraft, setCreditDraft] = useState("");

  // ---- free token allocation ----
  type FreeTokenStats = {
    totalUsers: number; exhaustedUsers: number; activeUsers: number; untouchedUsers: number;
    totalUsed: string; avgUsed: number; fivePercentCount: number;
  };
  const [freeStats, setFreeStats] = useState<FreeTokenStats | null>(null);
  const [freeStatsStatus, setFreeStatsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [freeStatsError, setFreeStatsError] = useState("");
  const [resetPercent, setResetPercent] = useState(5);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ count: number; emails: string[]; message: string } | null>(null);
  const [resetError, setResetError] = useState("");

  const loadFreeStats = useCallback(async () => {
    setFreeStatsStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/users/free-tokens-stats", { headers: await authHeaders() });
      if (!res.ok) { setFreeStatsError("Could not load free token stats."); setFreeStatsStatus("error"); return; }
      setFreeStats(await res.json() as FreeTokenStats);
      setFreeStatsStatus("ready");
    } catch {
      setFreeStatsError("Could not reach the gateway."); setFreeStatsStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void loadFreeStats(); }, [loadFreeStats]);

  const performReset = async () => {
    setResetting(true); setResetError(""); setResetResult(null);
    try {
      const res = await fetch("/backend/api/v1/admin/users/free-tokens/reset", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ percent: resetPercent }),
      });
      const body = await res.json().catch(() => null) as { resetCount?: number; sampledUserIds?: string[]; message?: string; error?: { message?: string } } | null;
      if (!res.ok) { setResetError(body?.error?.message ?? "Reset failed."); return; }
      // Fetch emails for sampled users
      let emails: string[] = [];
      if (body?.sampledUserIds?.length) {
        try {
          const eRes = await fetch(`/backend/api/v1/admin/users?limit=100`, { headers: await authHeaders() });
          if (eRes.ok) {
            const eData = await eRes.json() as { users?: { id: string; email: string }[] };
            const byId = new Map((eData.users ?? []).map(u => [u.id, u.email]));
            emails = (body.sampledUserIds ?? []).map(uid => byId.get(uid)).filter((e): e is string => typeof e === "string");
          }
        } catch { /* emails optional */ }
      }
      setResetResult({ count: body?.resetCount ?? 0, emails, message: body?.message ?? "Reset complete." });
      await loadFreeStats();
    } catch {
      setResetError("Could not reach the gateway.");
    } finally {
      setResetting(false);
    }
  };

  return <div className="page-stack">
    <div className="page-heading"><div>
      <div className="eyebrow small-eyebrow"><Users size={14}/> ADMIN / USERS</div>
      <h1>Users</h1>
      <p>Every account, what it holds, and what it has spent.</p>
    </div></div>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Accounts</h2><p>Search by email or name, filter by plan. Every registered account is listed.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void load(appliedSearch, planFilter, page, sortBy)}><RefreshCw size={15}/> Refresh</button>
      </div>

      <div className="users-toolbar">
        <label className="search-field">
          <Search size={14}/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") applySearch(); }}
            placeholder="Search email or name…"
            aria-label="Search accounts"
          />
        </label>
        <button className="button button-ink compact-button" type="button" onClick={applySearch}>Search</button>
        <div className="plan-pills">
          <button type="button" className={planFilter === "" ? "plan-pill plan-pill-on" : "plan-pill"} onClick={() => { setPlanFilter(""); setPage(1); void load(appliedSearch, "", 1, sortBy); }}>ALL</button>
          {ALL_PLANS.map(p => <button
            key={p} type="button"
            className={planFilter === p ? "plan-pill plan-pill-on" : "plan-pill"}
            onClick={() => { setPlanFilter(p); setPage(1); void load(appliedSearch, p, 1, sortBy); }}
          >{p}</button>)}
        </div>
        <div className="plan-pills">
          <button type="button" className={sortBy === "created" ? "plan-pill plan-pill-on" : "plan-pill"} onClick={() => { setSortBy("created"); setPage(1); void load(appliedSearch, planFilter, 1, "created"); }}>Newest</button>
          <button type="button" className={sortBy === "credits" ? "plan-pill plan-pill-on" : "plan-pill"} onClick={() => { setSortBy("credits"); setPage(1); void load(appliedSearch, planFilter, 1, "credits"); }}>Most credits</button>
        </div>
      </div>

      {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
        {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
      </p>}

      <div className="model-table-wrap">
        {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading accounts…</strong><p>Reading the user table.</p></div>}
        {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load accounts</strong><p>{error}</p><button type="button" className="button button-outline compact-button" onClick={() => void load(appliedSearch, planFilter)}>Retry</button></div>}
        {status === "ready" && (users.length === 0
          ? <div className="table-empty"><Users size={19}/><strong>No accounts found</strong><p>Try a different search or clear the plan filter.</p></div>
          : <table className="model-table users-table">
              <thead><tr>
                <th>ACCOUNT</th><th>PLAN</th><th>STATUS</th><th>CREDITS</th><th>KEYS</th><th>JOINED</th><th></th>
              </tr></thead>
              <tbody>{users.map(u => <tr key={u.id}>
                <td>
                  <strong>{[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email.split("@")[0]}</strong>
                  <small className="cell-sub">{u.email}</small>
                  {isSelf(u) && <small className="cell-sub self-tag">this is you</small>}
                </td>
                <td>
                  <Select
                    label={isSelf(u) ? "You cannot change your own plan" : `Change plan for ${u.email}`}
                    value={u.plan}
                    disabled={busyId === u.id || isSelf(u)}
                    onChange={v => setDialog({ kind: "plan", row: u, plan: v as Plan })}
                    width={112}
                    options={ALL_PLANS.map(p => ({ value: p, label: p }))}
                  />
                </td>
                <td><span className={`status-pill status-${u.status.toLowerCase()}`}>{u.status}</span></td>
                <td><span className="credit-cell"><Coins size={13}/>{formatCredits(u.credits)}</span></td>
                <td>{u.keyCount}</td>
                <td>{shortDate(u.createdAt)}</td>
                <td><span className="row-actions">
                  <button className="row-action" type="button" title="Adjust credits" aria-label={`Adjust credits for ${u.email}`} onClick={() => { setCreditDraft(""); setDialog({ kind: "credits", row: u }); }} disabled={busyId === u.id}><UserCog size={14}/></button>
                  <button className="row-action row-action-danger" type="button" title={isSelf(u) ? "You cannot delete yourself" : "Delete account"} aria-label={`Delete ${u.email}`} onClick={() => setDialog({ kind: "delete", row: u })} disabled={busyId === u.id || isSelf(u)}>
                    {busyId === u.id ? <Loader2 size={14} className="row-spinner"/> : <Trash2 size={14}/>}
                  </button>
                </span></td>
              </tr>)}</tbody>
            </table>)}

        {/* Outside the ready/empty branches so a page past the end still renders the pager
            — otherwise it would strand the operator with no way back. */}
        {status === "ready" && pager.total > 0 && (
          <div className="pagination">
            <span className="pagination-summary">
              {formatCount((page - 1) * pager.perPage + 1)}–{formatCount(Math.min(page * pager.perPage, pager.total))} of {formatCount(pager.total)}
            </span>
            <div className="pagination-controls">
              <button className="icon-button" type="button" onClick={() => { setPage(page - 1); void load(appliedSearch, planFilter, page - 1, sortBy); }} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={15}/></button>
              <span className="page-number page-current">{page}</span>
              <button className="icon-button" type="button" onClick={() => { setPage(page + 1); void load(appliedSearch, planFilter, page + 1, sortBy); }} disabled={page >= pager.totalPages} aria-label="Next page"><ChevronRight size={15}/></button>
            </div>
          </div>
        )}
      </div>
      <div className="table-note"><AlertTriangle size={14}/> Deleting an account also removes its keys and usage history — the confirmation says how much.</div>
    </section>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>Free token allocation</h2><p>Every user gets 20M tokens. Reset a random sample each cycle.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadFreeStats()} disabled={freeStatsStatus === "loading"}><RefreshCw size={15}/> Refresh</button>
      </div>

      {freeStatsStatus === "loading" && <div className="usage-loading"><Loader2 size={16} className="spin"/> Loading free token stats…</div>}
      {freeStatsStatus === "error" && <p className="success-line row-fail" role="status"><AlertTriangle size={14}/> {freeStatsError}</p>}
      {freeStatsStatus === "ready" && freeStats && <>
        <div className="usage-grid stats-grid">
          <article className="usage-stat">
            <div className="stat-top"><span>Total users</span><Users size={16}/></div>
            <strong>{formatCount(freeStats.totalUsers)}</strong>
            <small>{freeStats.fivePercentCount} in a 5% sample</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Exhausted</span><AlertTriangle size={16}/></div>
            <strong>{formatCount(freeStats.exhaustedUsers)}</strong>
            <small>at 20M/20M</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Avg usage</span><Coins size={16}/></div>
            <strong>{formatCounter(freeStats.avgUsed)}</strong>
            <small>per active user</small>
          </article>
          <article className="usage-stat">
            <div className="stat-top"><span>Total used</span><Coins size={16}/></div>
            <strong>{formatCounter(Number(freeStats.totalUsed))}</strong>
            <small>free tokens spent</small>
          </article>
        </div>

        {freeStats.totalUsers > 0 && (
          <div className="progress-bar-wrap" style={{ margin: "16px 0" }}>
            <div className="progress-bar-label">
              <span>Exhausted users</span>
              <span>{freeStats.exhaustedUsers} of {freeStats.totalUsers} ({Math.round((freeStats.exhaustedUsers / freeStats.totalUsers) * 100)}%)</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${(freeStats.exhaustedUsers / freeStats.totalUsers) * 100}%` }} />
            </div>
          </div>
        )}
      </>}

      <div className="reset-panel" style={{ marginTop: 20, padding: 16, border: "1px solid var(--border, #e5e7eb)", borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <RefreshCw size={16}/>
          <strong>Rolling reset</strong>
        </div>
        <p style={{ color: "var(--muted, #6b7280)", fontSize: 14, marginBottom: 12 }}>
          Reset free tokens for {resetPercent}% of eligible users. Those who haven&apos;t used any are skipped.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Select
            label="Reset percentage"
            value={String(resetPercent)}
            onChange={v => setResetPercent(Number(v))}
            width={100}
            options={[5, 10, 25, 50].map(p => ({ value: String(p), label: `${p}%` }))}
          />
          <button
            className="button button-ink compact-button"
            type="button"
            onClick={() => void performReset()}
            disabled={resetting || freeStatsStatus !== "ready"}
          >
            {resetting ? <><Loader2 size={14} className="row-spinner"/> Resetting…</> : `Reset ${resetPercent}% sample`}
          </button>
        </div>
        {resetError && <p className="success-line row-fail" role="status" style={{ marginTop: 12 }}><AlertTriangle size={14}/> {resetError}</p>}
        {resetResult && <div style={{ marginTop: 12 }}>
          <p className="success-line" role="status" style={{ color: "var(--green, #16a34a)" }}><Check size={14}/> {resetResult.message}</p>
          {resetResult.emails.length > 0 && <small style={{ display: "block", marginTop: 6, color: "var(--muted, #6b7280)" }}>
            Reset: {resetResult.emails.slice(0, 5).join(", ")}{resetResult.emails.length > 5 ? ` +${resetResult.emails.length - 5} more` : ""}
          </small>}
        </div>}
      </div>
    </section>

    <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">03</span><div><h2>Operator rules</h2><p>What this page will and will not do.</p></div></div><ShieldCheck size={16}/></div>
      <ul className="rules-list">
        <li>You cannot change your own plan — that would let the last operator lock itself out irrecoverably.</li>
        <li>You cannot delete your own account, for the same reason.</li>
        <li>Credits are adjusted as signed amounts and floored at zero, so a deduction never creates debt.</li>
        <li>Every change writes an entry to <code>admin_audit</code> with who did it and what changed.</li>
      </ul>
    </section>

    {/*
      One dialog at a time, keyed off `dialog.kind`. Each renders the account it was opened
      for, so the operator never has to match the dialog back to a row by memory.
    */}
    <Modal
      open={dialog?.kind === "credits"}
      title="Adjust credits"
      subtitle="Applied as a signed amount. The balance is floored at zero, so a deduction can never create debt."
      busy={busyId !== null}
      onClose={() => setDialog(null)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setDialog(null)} disabled={busyId !== null}>Cancel</button>
        <button
          className="button button-ink compact-button"
          type="button"
          disabled={busyId !== null || !isValidDelta(creditDraft)}
          onClick={() => { if (dialog?.kind === "credits") void adjustCredits(dialog.row, Number(creditDraft)); }}
        >
          {busyId !== null ? <><Loader2 size={13} className="row-spinner"/> Applying…</> : "Apply"}
        </button>
      </>}
    >
      {dialog?.kind === "credits" && <>
        <div className="modal-subject">
          <strong>{dialog.row.email}</strong>
          <small>Current balance <span className="modal-balance">{formatCredits(dialog.row.credits)}</span></small>
        </div>
        <label className="modal-field">
          <span>SIGNED AMOUNT</span>
          <div className="modal-input">
            <Coins size={15}/>
            <input
              value={creditDraft}
              onChange={e => setCreditDraft(e.target.value.replace(/[^0-9-]/g, ""))}
              placeholder="e.g. 500 or -200"
              inputMode="numeric"
              aria-label="Credit adjustment"
            />
          </div>
        </label>
        <div className="modal-quick">
          {[100, 500, 1000].map(v => <button key={v} type="button" onClick={() => setCreditDraft(String(v))}>+{v}</button>)}
          {[-100, -500].map(v => <button key={v} type="button" onClick={() => setCreditDraft(String(v))}>{v}</button>)}
        </div>
        <p className="modal-hint">{deltaPreview(creditDraft, dialog.row.credits)}</p>
      </>}
    </Modal>

    <Modal
      open={dialog?.kind === "plan"}
      title="Change plan"
      subtitle="Plan decides which models this account may call."
      busy={busyId !== null}
      onClose={() => setDialog(null)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setDialog(null)} disabled={busyId !== null}>Cancel</button>
        <button
          className="button button-ink compact-button"
          type="button"
          disabled={busyId !== null}
          onClick={() => { if (dialog?.kind === "plan") void changePlan(dialog.row, dialog.plan); }}
        >
          {busyId !== null ? <><Loader2 size={13} className="row-spinner"/> Saving…</> : `Set ${dialog?.kind === "plan" ? dialog.plan : ""}`}
        </button>
      </>}
    >
      {dialog?.kind === "plan" && <>
        <div className="modal-subject">
          <strong>{dialog.row.email}</strong>
          <small>Plan <span className="modal-balance">{dialog.row.plan}</span> → <span className="modal-balance">{dialog.plan}</span></small>
        </div>
        <div className="modal-warning"><AlertTriangle size={15}/> {dialog.plan === "SUPERUSER"
          ? "SUPERUSER grants full administrative access to this console, including every other account."
          : "If this is the last SUPERUSER, the console loses its administrator."}</div>
      </>}
    </Modal>

    <Modal
      open={dialog?.kind === "delete"}
      tone="danger"
      title="Delete account"
      subtitle="This cannot be undone."
      busy={busyId !== null}
      onClose={() => setDialog(null)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setDialog(null)} disabled={busyId !== null}>Cancel</button>
        <button
          className="button button-ink compact-button"
          type="button"
          disabled={busyId !== null}
          onClick={() => { if (dialog?.kind === "delete") void remove(dialog.row); }}
        >
          {busyId !== null ? <><Loader2 size={13} className="row-spinner"/> Deleting…</> : "Delete permanently"}
        </button>
      </>}
    >
      {dialog?.kind === "delete" && <>
        <div className="modal-subject">
          <strong>{dialog.row.email}</strong>
          <small>{dialog.row.plan} · joined {shortDate(dialog.row.createdAt)}</small>
        </div>
        <div className="modal-danger-note"><AlertTriangle size={15}/>
          <span>Deleting also removes, permanently: <strong>{dialog.row.keyCount}</strong> gateway key(s) and everything in this account&apos;s usage history.</span>
        </div>
      </>}
    </Modal>
  </div>;
}
