"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Fingerprint, Flag, Globe2, Loader2, RefreshCw, Search, ShieldAlert, Undo2, Users } from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { Pager } from "@/components/pager";

type FlaggedAccount = {
  id: string;
  userId: string;
  email: string;
  riskScore: number;
  riskCategory: string;
  matchedRules: string[];
  riskReasons: string[];
  freeTokensUsed: number;
  signupIp: string | null;
  signupDomain: string | null;
  abuseFlagged: boolean;
  abuseFlaggedAt: string | null;
};

type TallyRow = { category: string; assessments: number; flagged: number };
type ClusterRow = { clientId: string; domain: string | null; accounts: number; flagged: number };
type Report = {
  assessments: FlaggedAccount[];
  tally: TallyRow[];
  clusters: ClusterRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  clusterPage: number;
  clusterPerPage: number;
  clusterTotal: number;
  clusterTotalPages: number;
};
type Status = "loading" | "ready" | "error";

/** Rows per page in the assessments table. */
const PAGE_SIZE = 15;
/** Clusters per page; a cluster row is wider than an assessment row. */
const CLUSTER_PAGE_SIZE = 8;

const FREE_LIMIT = 20_000_000;
const REASON_LABEL: Record<string, string> = { shared_identity: "Same device", domain_allowance: "Domain overflow" };
const formatCount = (n: number): string => n.toLocaleString("en-US");
const stamp = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function AdminSignupRiskSection() {
  const { getToken } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [clusterPage, setClusterPage] = useState(1);
  const [search, setSearch] = useState("");
  const [flagFilter, setFlagFilter] = useState<"all" | "flagged" | "unflagged">("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  // `load` takes the pages it should fetch and does not read the page state, so
  // it stays stable across renders and cannot re-trigger itself.
  const load = useCallback(async (pageNo: number, clusterNo: number) => {
    setStatus("loading");
    try {
      const token = await getToken();
      const query = new URLSearchParams({
        page: String(pageNo),
        limit: String(PAGE_SIZE),
        clusterPage: String(clusterNo),
        clusterLimit: String(CLUSTER_PAGE_SIZE),
        search,
        flagged: flagFilter,
        category: categoryFilter,
      });
      const res = await fetch(`/backend/api/v1/admin/users/risk?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setError(res.status === 404 ? "This account is not an administrator." : "Could not load signup risk review."); setStatus("error"); return; }
      const data = await res.json() as Report;
      setReport({
        assessments: Array.isArray(data.assessments) ? data.assessments : [],
        tally: Array.isArray(data.tally) ? data.tally : [],
        clusters: Array.isArray(data.clusters) ? data.clusters : [],
        page: Number(data.page ?? pageNo),
        perPage: Number(data.perPage ?? PAGE_SIZE),
        total: Number(data.total ?? 0),
        totalPages: Number(data.totalPages ?? 1),
        clusterPage: Number(data.clusterPage ?? clusterNo),
        clusterPerPage: Number(data.clusterPerPage ?? CLUSTER_PAGE_SIZE),
        clusterTotal: Number(data.clusterTotal ?? 0),
        clusterTotalPages: Number(data.clusterTotalPages ?? 1),
      });
      setPage(Number(data.page ?? pageNo));
      setClusterPage(Number(data.clusterPage ?? clusterNo));
      setStatus("ready");
    } catch { setError("Could not reach the backend."); setStatus("error"); }
  }, [getToken, search, flagFilter, categoryFilter]);

  useEffect(() => { void load(1, 1); }, [load]);

  const clearFlag = async (row: FlaggedAccount) => {
    setNotice(null); setBusyId(row.id);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk/clear", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ userId: row.id }) });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not clear the flag." }); return; }
      setNotice({ kind: "ok", text: `${row.email} restored to a full allowance.` });
      await load(page, clusterPage);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusyId(null); }
  };

  const toggleManualFlag = async (row: FlaggedAccount) => {
    setNotice(null); setBusyId(row.userId);
    try {
      const token = await getToken();
      const next = !row.abuseFlagged;
      const res = await fetch("/backend/api/v1/admin/users/flag", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, flagged: next, reason: "manual review from signup risk assessment" }),
      });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not change the flag." }); return; }
      setNotice({ kind: "ok", text: next
        ? `${row.email} flagged. It will be skipped by the free-token roll; allowance unchanged.`
        : `${row.email} unflagged.` });
      await load(page, clusterPage);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusyId(null); }
  };

  const flagEligible = async () => {
    if (!window.confirm("Flag all currently unflagged accounts whose latest risk assessment is high_risk or review_required?")) return;
    setNotice(null); setBulkBusy(true);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk/flag-eligible", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => null) as { updated?: number; error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not flag eligible accounts." }); return; }
      setNotice({ kind: "ok", text: `${body?.updated ?? 0} eligible account(s) flagged.` });
      await load(page, clusterPage);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBulkBusy(false); }
  };

  const assessments = report?.assessments ?? [];
  const tally = report?.tally ?? [];
  const clusters = report?.clusters ?? [];

  return <section className="admin-signup-risk-section">
      <div className="section-title-row">
      <div><span className="section-index">03</span><div><h2>Signup security</h2><p>Risk at registration: IP, browser, domain, identity and signup history. Review and manually flag accounts here.</p></div></div>
      <button className="button button-outline compact-button" type="button" onClick={() => void load(page, clusterPage)} disabled={status === "loading"}><RefreshCw size={14}/> Refresh</button>
    </div>
    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status"><ShieldAlert size={14}/>{notice.text}</p>}
    {status === "loading" && <div className="usage-loading"><Loader2 size={16} className="spin"/> Loading signup risk review…</div>}
    {status === "error" && <p className="success-line row-fail" role="status"><AlertTriangle size={14}/> {error}</p>}
    {status === "ready" && <>
      <div className="usage-grid stats-grid">
        <article className="usage-stat"><div className="stat-top"><span>Assessments</span><ShieldAlert size={16}/></div><strong>{formatCount(assessments.length)}</strong><small>latest page loaded</small></article>
        <article className="usage-stat"><div className="stat-top"><span>Flagged accounts</span><ShieldAlert size={16}/></div><strong>{formatCount(assessments.filter(a => a.abuseFlagged).length)}</strong><small>individual actions only</small></article>
        <article className="usage-stat"><div className="stat-top"><span>Repeated clients</span><Fingerprint size={16}/></div><strong>{formatCount(clusters.length)}</strong><small>investigation signals</small></article>
      </div>
      <div className="admin-risk-subsection">
        <div className="section-title-row"><div><div><h3>Risk assessments</h3><p>Score, category, rules and reasons. Flagged accounts remain usable; manual flag adds no penalty.</p></div></div><button className="button button-outline compact-button" type="button" onClick={() => void flagEligible()} disabled={bulkBusy}><Flag size={14}/>{bulkBusy ? "Flagging…" : "Flag eligible accounts"}</button></div>
      <div className="users-toolbar risk-filters">
        <label className="search-field"><Search size={14}/><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search email or name" aria-label="Search signup risk accounts" /></label>
        <select value={flagFilter} onChange={event => { setFlagFilter(event.target.value as typeof flagFilter); setPage(1); }} aria-label="Filter account flag">
          <option value="all">All flags</option><option value="flagged">Flagged</option><option value="unflagged">Unflagged</option>
        </select>
        <select value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setPage(1); }} aria-label="Filter risk category">
          <option value="">All categories</option><option value="normal">Normal</option><option value="suspicious">Suspicious</option><option value="elevated">Elevated</option><option value="high_risk">High risk</option><option value="review_required">Review required</option>
        </select>
      </div>
      {assessments.length === 0 ? <div className="model-table-wrap"><table className="model-table usage-table accounts-table"><thead><tr><th>Account</th><th>Score</th><th>Category</th><th>Rules</th><th>Signup context</th><th>Flag</th></tr></thead><tbody><tr><td colSpan={6}><div className="table-empty"><Users size={20}/><strong>No assessments found</strong><p>Try changing the search or filters.</p></div></td></tr></tbody></table></div> : <div className="model-table-wrap"><table className="model-table usage-table accounts-table"><thead><tr><th>Account</th><th>Score</th><th>Category</th><th>Rules</th><th>Signup context</th><th>Flag</th></tr></thead><tbody>{assessments.map(row => <tr key={row.id}><td><strong>{row.email}</strong><span className="cell-sub">{row.riskReasons[0] ?? "No reason recorded"}</span></td><td className="cell-num">{row.riskScore}</td><td><span className={`outcome-pill outcome-${row.riskCategory === "normal" ? "ok" : row.riskCategory === "suspicious" ? "interrupted" : "error"}`}>{row.riskCategory}</span></td><td><code title={row.matchedRules.join(", ")}>{row.matchedRules.length ? row.matchedRules.slice(0, 2).join(", ") : "—"}</code></td><td><span className="cell-sub">{row.signupDomain ?? "—"}</span><span className="cell-sub">{row.signupIp ?? "IP unknown"}</span></td><td>{row.abuseFlagged ? <span className="row-actions"><span className="outcome-pill outcome-error">flagged</span><button className="row-action row-action-danger" type="button" title="Unflag this account" aria-label={`Unflag ${row.email}`} onClick={() => void toggleManualFlag(row)} disabled={busyId === row.userId}><Undo2 size={14}/></button></span> : <button className="row-action" type="button" title="Flag this account manually" aria-label={`Flag ${row.email}`} onClick={() => void toggleManualFlag(row)} disabled={busyId === row.userId}><Flag size={14}/></button>}</td></tr>)}</tbody></table></div>}
      <Pager
          page={report?.page ?? 1}
          perPage={report?.perPage ?? PAGE_SIZE}
          total={report?.total ?? 0}
          totalPages={report?.totalPages ?? 1}
          onPage={pageNo => void load(pageNo, clusterPage)}
          busy={false}
        />
      </div>
      <div className="admin-risk-subsection">
        <div className="section-title-row"><div><div><h3>Risk category tally</h3><p>Historical assessment distribution; categories do not block domains.</p></div></div></div>
        {tally.length === 0 ? <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Category</th><th>Assessments</th><th>Flagged</th></tr></thead><tbody><tr><td colSpan={3}><div className="table-empty"><Globe2 size={20}/><strong>No tally yet</strong><p>Risk categories appear after the first signup assessment.</p></div></td></tr></tbody></table></div> : <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Category</th><th>Assessments</th><th>Flagged</th></tr></thead><tbody>{tally.map(t => <tr key={t.category}><td>{t.category}</td><td className="cell-num">{formatCount(t.assessments)}</td><td className="cell-num">{formatCount(t.flagged)}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="admin-risk-subsection">
        <div className="section-title-row"><div><div><h3>Client reputation clusters</h3><p>Correlation only; membership never cascades enforcement.</p></div></div></div>
        {clusters.length === 0 ? <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Client</th><th>Domain</th><th>Accounts</th><th>Flagged</th></tr></thead><tbody><tr><td colSpan={4}><div className="table-empty"><Fingerprint size={20}/><strong>No repeated clients</strong><p>Client reputation clusters appear when multiple accounts share a browser instance.</p></div></td></tr></tbody></table></div> : <div className="model-table-wrap"><table className="model-table"><thead><tr><th>Client</th><th>Domain</th><th>Accounts</th><th>Flagged</th></tr></thead><tbody>{clusters.map(c => <tr key={`${c.clientId}-${c.domain}`}><td><code>{c.clientId}</code></td><td>{c.domain ?? "—"}</td><td className="cell-num">{formatCount(c.accounts)}</td><td className="cell-num">{formatCount(c.flagged)}</td></tr>)}</tbody></table></div>}
        <Pager
          page={report?.clusterPage ?? 1}
          perPage={report?.clusterPerPage ?? CLUSTER_PAGE_SIZE}
          total={report?.clusterTotal ?? 0}
          totalPages={report?.clusterTotalPages ?? 1}
          onPage={clusterNo => void load(page, clusterNo)}
          busy={false}
        />
      </div>
    </>}
    <div className="table-note"><AlertTriangle size={13}/> Shadow mode is active: assessments are saved, but new signup restrictions are not applied.</div>
  </section>;
}
