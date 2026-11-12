"use client";

/**
 * Risk intelligence — the single operator view of abuse evidence.
 *
 * Three questions used to live in two separate sections (signup security and
 * gateway usage reputation) plus a backend-only ledger. They are the same
 * question asked at three moments — who registered, how the account is used,
 * and what the shared evidence says — so they belong in ONE page section with
 * tabs, not in three stacked cards.
 *
 * Shape rules this file follows (see `admin-console-section-hierarchy`):
 *  - the page owns the section number; the tabs and subsections carry none;
 *  - a subsection is a ruled band, never a nested card;
 *  - evidence is global, every action is per account — the only mutations here
 *    are flagging ONE account, flagging the eligible set, and clearing ONE
 *    account's usage reputation.
 *
 * The old `AdminSignupRiskSection` / `AdminAccountReputationSection` components
 * and their endpoints are kept intact; they are simply no longer rendered on
 * the page, so the console does not show the same table twice.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle, Flag, Globe2, Layers, Loader2, RefreshCw,
  Search, ShieldAlert, ShieldCheck, Undo2, Users,
} from "lucide-react";
import { Pager } from "@/components/pager";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";

/* ------------------------------------------------------------------ types */

type UnifiedDecision = {
  signup: { category: string; score: number };
  usage: { tier: string; score: number | null; requestCount: number };
  eligible: boolean;
  reason: string | null;
};

type GatewayStats = {
  distinctIpCount: number;
  sharedIpCount: number;
  apiKeyCount: number;
  reasons: string[];
  ips: string[];
  sharedIps: string[];
};

type SignupAssessment = {
  id: string | null;
  userId: string;
  email: string;
  riskScore: number | null;
  riskCategory: string | null;
  matchedRules: string[] | null;
  riskReasons: string[] | null;
  signupIp: string | null;
  signupDomain: string | null;
  abuseFlagged: boolean;
  freeTokensUsed: number;
  plan: string | null;
  evaluatedAt: string | null;
  unifiedDecision: UnifiedDecision;
  gatewayStats: GatewayStats;
};

type SignupReport = {
  assessments: SignupAssessment[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

type EvidenceRow = {
  id: string;
  label: string;
  valueKind: string;
  valueHash: string;
  valueDisplay: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  distinctAccountCount: number;
  distinctIpCount: number;
  distinctKeyCount: number;
  flaggedAccountCount: number;
  requestCount: number;
  riskWeight: number;
  metadata: Record<string, unknown> | null;
};

type EvidenceReport = {
  rows: EvidenceRow[];
  page: number;
  limit: number;
  total: number;
};

type Status = "loading" | "ready" | "error";
type Tab = "signup" | "evidence";

/* ---------------------------------------------------------------- helpers */

const SIGNUP_PAGE_SIZE = 20;
const EVIDENCE_PAGE_SIZE = 20;

/** The only evidence sources the backend accepts. */
const SOURCES = ["signup", "gateway", "backfill", "manual"] as const;

/**
 * Labels the writers actually emit. The endpoint filters by EXACT label, so a
 * free-text box would mostly return nothing; a select of the real values is the
 * honest control.
 */
const LABELS = [
  "SAME_IP", "SAME_DOMAIN", "SAME_NAME", "SAME_LOCAL_STEM", "SAME_CLIENT",
  "SAME_IP_NAME", "SAME_NAME_DOMAIN", "SAME_NAME_DOMAIN_IP", "IP_SEGMENT_DENSITY",
  "IP_MULTI_ACCOUNT", "IP_SEGMENT_MULTI_ACCOUNT", "KEY_MULTI_IP", "KEY_MULTI_ACCOUNT",
  "ACCOUNT_MULTI_KEY",
  "HISTORICAL_BAD_IP", "HISTORICAL_BAD_DOMAIN", "HISTORICAL_BAD_NAME", "HISTORICAL_BAD_COMBINATION",
  "MANUAL_CONFIRMED_ABUSE", "MANUAL_FALSE_POSITIVE", "MANUAL_REVIEW",
] as const;

const VALUE_KINDS = [
  "ip", "ip_segment", "ip_name", "domain", "name_domain", "name", "localStem", "localShape",
  "client", "api_key", "combination", "account_reputation", "manual_review",
] as const;

const formatCount = (n: number): string => n.toLocaleString("en-US");

const stamp = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Category → pill class. Anything above "suspicious" reads as trouble. */
const categoryClass = (category: string): string =>
  category === "normal" ? "outcome-ok"
    : category === "suspicious" ? "outcome-interrupted"
    : "outcome-error";

const tierClass = (tier: string): string =>
  tier === "bad" ? "outcome-error" : tier === "warning" ? "outcome-interrupted" : "outcome-ok";

/** A hash prefix is all an operator needs to correlate two rows. */
const shortHash = (hash: string): string => `${hash.slice(0, 10)}…`;

const errorFor = (status: number, what: string): string =>
  status === 401 || status === 403 || status === 404
    ? "This account is not an administrator."
    : `Could not load ${what}.`;

/* ------------------------------------------------------------------ panel */

export function AdminRiskIntelligenceSection() {
  const [tab, setTab] = useState<Tab>("signup");
  // A panel mounts the first time its tab is opened and stays mounted after
  // that, so switching tabs never loses a filter, a page or a scroll position.
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ signup: true, evidence: false });
  const [refreshKey, setRefreshKey] = useState(0);

  const open = (next: Tab) => {
    setTab(next);
    setVisited(current => (current[next] ? current : { ...current, [next]: true }));
  };

  const tabProps = (id: Tab) => ({
    role: "tab" as const,
    id: `risk-tab-${id}`,
    "aria-selected": tab === id,
    "aria-controls": `risk-panel-${id}`,
    tabIndex: tab === id ? 0 : -1,
    onClick: () => open(id),
  });

  return <section className="console-section risk-intel">
    <div className="section-title-row">
      <div>
        <span className="section-index">04</span>
        <div>
          <h2>Risk intelligence</h2>
          <p>Account assessments and the shared evidence ledger. Evidence is global; every action is per account.</p>
        </div>
      </div>
      <div className="reputation-actions">
        <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => setRefreshKey(key => key + 1)}
          title="Reload the open tab"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
    </div>

    <div className="risk-tabs" role="tablist" aria-label="Risk intelligence views">
      <button type="button" {...tabProps("signup")}><ShieldAlert size={14} /> Account assessments</button>
      <button type="button" {...tabProps("evidence")}><Layers size={14} /> Evidence ledger</button>
    </div>

    <div
      id="risk-panel-signup"
      role="tabpanel"
      aria-labelledby="risk-tab-signup"
      hidden={tab !== "signup"}
    >
      {visited.signup && <SignupPanel refreshKey={refreshKey} />}
    </div>


    <div
      id="risk-panel-evidence"
      role="tabpanel"
      aria-labelledby="risk-tab-evidence"
      hidden={tab !== "evidence"}
    >
      {visited.evidence && <EvidencePanel refreshKey={refreshKey} />}
    </div>
  </section>;
}

/* ------------------------------------------------------------ signup side */

function SignupPanel({ refreshKey }: { refreshKey: number }) {
  const { getToken } = useAuth();
  const [report, setReport] = useState<SignupReport | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewMenuFor, setReviewMenuFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<"evaluated" | "score">("evaluated");
  const [reasonPopup, setReasonPopup] = useState<{ email: string; tier?: string; items: { reason: string; rule?: string }[] } | null>(null);

  // `load` takes the page it should fetch instead of reading page state, so it
  // stays stable and cannot re-trigger itself.
  const load = useCallback(async (pageNo: number) => {
    setStatus("loading");
    try {
      const token = await getToken();
      const query = new URLSearchParams({
        page: String(pageNo),
        limit: String(SIGNUP_PAGE_SIZE),
        search,
        category: categoryFilter,
        sort: sortBy,
      });
      const res = await fetch(`/backend/api/v1/admin/users/risk?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setError(errorFor(res.status, "signup risk review")); setStatus("error"); return; }
      const data = await res.json() as SignupReport;
      setReport({
        assessments: Array.isArray(data.assessments) ? data.assessments : [],
        page: Number(data.page ?? pageNo),
        perPage: Number(data.perPage ?? SIGNUP_PAGE_SIZE),
        total: Number(data.total ?? 0),
        totalPages: Number(data.totalPages ?? 1),
      });
      setStatus("ready");
    } catch { setError("Could not reach the backend."); setStatus("error"); }
  }, [getToken, search, categoryFilter, sortBy]);

  useEffect(() => { void load(1); }, [load, refreshKey]);

  const page = report?.page ?? 1;

  const toggleManualFlag = async (row: SignupAssessment) => {
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
      await load(page);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusyId(null); }
  };

  const recordManualReview = async (row: SignupAssessment, label: "MANUAL_CONFIRMED_ABUSE" | "MANUAL_FALSE_POSITIVE" | "MANUAL_REVIEW") => {
    setReviewMenuFor(null);
    setNotice(null); setBusyId(row.userId);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk-evidence/manual", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, label, reason: `manual review from risk intelligence` }),
      });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not record the review." }); return; }
      const text = label === "MANUAL_CONFIRMED_ABUSE"
        ? `${row.email} recorded as confirmed abuse.`
        : label === "MANUAL_FALSE_POSITIVE"
          ? `${row.email} recorded as a false positive.`
          : `${row.email} marked as under review.`;
      setNotice({ kind: "ok", text });
      await load(page);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusyId(null); }
  };

  const rows = report?.assessments ?? [];

  return <>
    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status">
      <ShieldAlert size={14} />{notice.text}
    </p>}

    <div className="admin-risk-subsection">
      <div className="section-title-row">
        <div><div>
          <h3>Account assessments</h3>
          <p>Signup risk score, gateway IP tracking and evidence ledger. Scores are computed at signup.</p>
        </div></div>
      </div>

      <div className="users-toolbar risk-filters">
        <label className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search email or name"
            aria-label="Search signup risk accounts"
          />
        </label>
        <Select
          label="Filter risk category"
          value={categoryFilter}
          onChange={v => setCategoryFilter(v)}
          width={150}
          options={[
            { value: "", label: "All categories" },
            { value: "normal", label: "Normal" },
            { value: "suspicious", label: "Suspicious" },
            { value: "elevated", label: "Elevated" },
            { value: "high_risk", label: "High risk" },
            { value: "review_required", label: "Review required" },
            { value: "not_assessed", label: "Not assessed" },
          ]}
        />
        <Select
          label="Sort by"
          value={sortBy}
          onChange={v => { setSortBy(v as "evaluated" | "score"); }}
          width={140}
          options={[
            { value: "evaluated", label: "Newest assessed" },
            { value: "score", label: "Highest score" },
          ]}
        />
      </div>

      {status === "loading" && <div className="risk-loading-centered"><Loader2 size={24} className="spin" /> <span>Loading account assessments…</span></div>}
      {status === "error" && <div className="risk-loading-centered"><AlertTriangle size={24} /> <span>{error}</span></div>}

      {status === "ready" && <>
        <div className="risk-summary">
          <span><b>{formatCount(report?.total ?? 0)}</b> assessments</span>
        </div>

        <div className="model-table-wrap">
          <table className="model-table usage-table accounts-table">
            <thead><tr>
              <th style={{whiteSpace:"nowrap",minWidth:"100px"}}>Account</th><th style={{whiteSpace:"nowrap"}}>Plan</th><th style={{whiteSpace:"nowrap"}}>Score</th><th style={{whiteSpace:"nowrap"}}>Category</th><th style={{whiteSpace:"nowrap"}}>Reasons</th><th style={{whiteSpace:"nowrap"}}>Free tokens</th><th style={{whiteSpace:"nowrap"}}>Evaluated</th><th style={{whiteSpace:"nowrap"}}>Action</th>
            </tr></thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={8}>
                    <div className="table-empty">
                      <Users size={20} /><strong>No assessments found</strong>
                      <p>Try changing the search or filters.</p>
                    </div>
                  </td></tr>
                : rows.map(row => {
                  const reasons = row.riskReasons ?? [];
                  const rules = row.matchedRules ?? [];
                  return <tr key={row.id ?? row.userId}>
                    <td>
                      <strong>{row.email}</strong>
                      <span className="cell-sub">{row.signupDomain ?? "—"}{row.signupIp ? ` · ${row.signupIp}` : ""}</span>
                    </td>
                    <td><span className="plan-tag">{row.plan ?? "—"}</span></td>
                    <td className="cell-num">{row.riskScore ?? "—"}</td>
                    <td>
                      <span className={`outcome-pill ${categoryClass(row.riskCategory ?? "not_assessed")}`}>{row.riskCategory ?? "not assessed"}</span>
                    </td>
                    <td>
                      {reasons.length > 0
                        ? <button className="risk-icon-btn" type="button" title={`${reasons.length} reason(s)`} onClick={() => setReasonPopup({ email: row.email, items: reasons.map((r, i) => ({ reason: r, rule: rules[i] })) })}>
                            <AlertTriangle size={15} /> {reasons.length}
                          </button>
                        : <span className="cell-muted">—</span>}
                    </td>
                    <td className="cell-num">{row.freeTokensUsed != null ? row.freeTokensUsed.toLocaleString("en-US") : "—"}</td>
                    <td className="cell-num">{row.evaluatedAt ? new Date(row.evaluatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</td>
                    <td>
                      <div className="row-actions" style={{ gap: 6 }}>
                        {row.abuseFlagged
                          ? <button
                              className="row-action row-action-danger"
                              type="button"
                              title="Flagged — click to unflag"
                              aria-label={`Unflag ${row.email}`}
                              onClick={() => void toggleManualFlag(row)}
                              disabled={busyId === row.userId}
                            >
                              {busyId === row.userId ? <Loader2 size={14} className="row-spinner" /> : <Flag size={14} />}
                            </button>
                          : <button
                              className="row-action"
                              type="button"
                              title="Flag this account manually"
                              aria-label={`Flag ${row.email}`}
                              onClick={() => void toggleManualFlag(row)}
                              disabled={busyId === row.userId}
                            >
                              {busyId === row.userId ? <Loader2 size={14} className="row-spinner" /> : <Flag size={14} />}
                            </button>}
                        <details className="risk-review-menu" open={reviewMenuFor === row.userId}>
                          <summary
                            className="row-action"
                            title="Record a manual review outcome"
                            aria-label={`Review ${row.email}`}
                            onClick={event => {
                              event.preventDefault();
                              setReviewMenuFor(current => current === row.userId ? null : row.userId);
                            }}
                          >
                            {busyId === row.userId ? <Loader2 size={14} className="row-spinner" /> : <Search size={14} />}
                          </summary>
                          <div className="risk-review-options">
                            <button type="button" onClick={() => void recordManualReview(row, "MANUAL_REVIEW")}>Under review</button>
                            <button type="button" onClick={() => void recordManualReview(row, "MANUAL_CONFIRMED_ABUSE")}>Confirmed abuse</button>
                            <button type="button" onClick={() => void recordManualReview(row, "MANUAL_FALSE_POSITIVE")}>False positive</button>
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>})}
            </tbody>
          </table>
        </div>

        <Pager
          page={page}
          perPage={report?.perPage ?? SIGNUP_PAGE_SIZE}
          total={report?.total ?? 0}
          totalPages={report?.totalPages ?? 1}
          onPage={pageNo => void load(pageNo)}
          busy={false}
        />
      </>}
    </div>

    <div className="table-note">
      <AlertTriangle size={13} /> Signup enforcement is separate from the manual flag: the flag only excludes an account from the free-token roll.
    </div>

    <Modal
      open={reasonPopup !== null}
      title={reasonPopup ? `Risk reasons — ${reasonPopup.email}` : "Risk reasons"}
      onClose={() => setReasonPopup(null)}
      footer={<button className="button button-ink compact-button" type="button" onClick={() => setReasonPopup(null)}>Close</button>}
    >
      {reasonPopup && <div className="risk-reason-popup">
        {reasonPopup.tier && <div className="risk-reason-popup-tier">
          <span className={`outcome-pill ${tierClass(reasonPopup.tier)}`}>{reasonPopup.tier}</span>
        </div>}
        {reasonPopup.items.length === 0
          ? <p className="modal-note">No specific reasons recorded — tier based on aggregate score.</p>
          : reasonPopup.items.map((item, i) => <div key={i} className="risk-reason-popup-item">
            <div className="risk-reason-popup-reason">{item.reason}</div>
            {item.rule && <code className="risk-reason-rule">{item.rule}</code>}
          </div>)}
      </div>}
    </Modal>
  </>;
}

/* ---------------------------------------------------------- evidence side */

function EvidencePanel({ refreshKey }: { refreshKey: number }) {
  const { getToken } = useAuth();
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [valueKind, setValueKind] = useState("");
  const [source, setSource] = useState("");

  const load = useCallback(async (pageNo: number) => {
    setStatus("loading");
    try {
      const token = await getToken();
      const query = new URLSearchParams({ page: String(pageNo), limit: String(EVIDENCE_PAGE_SIZE) });
      if (label) query.set("label", label);
      if (valueKind) query.set("value_kind", valueKind);
      if (source) query.set("source", source);
      const res = await fetch(`/backend/api/v1/admin/users/risk-evidence?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setError(errorFor(res.status, "the evidence ledger")); setStatus("error"); return; }
      const data = await res.json() as EvidenceReport;
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const total = Number(data.total ?? 0);
      const limit = Number(data.limit ?? EVIDENCE_PAGE_SIZE);
      // A filter can empty the last page while the operator is standing on it.
      if (rows.length === 0 && pageNo > 1 && total > 0) { await load(1); return; }
      setReport({ rows, page: Number(data.page ?? pageNo), limit, total });
      setStatus("ready");
    } catch { setError("Could not reach the backend."); setStatus("error"); }
  }, [getToken, label, valueKind, source]);

  useEffect(() => { void load(1); }, [load, refreshKey]);

  const rows = report?.rows ?? [];
  const total = report?.total ?? 0;
  const limit = report?.limit ?? EVIDENCE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const filtered = Boolean(label || valueKind || source);

  return <>
    <div className="admin-risk-subsection">
      <div className="section-title-row">
        <div><div>
          <h3>Evidence ledger</h3>
          <p>One aggregate row per observed value, across signup, gateway, backfill and manual sources. Sensitive values are stored as SHA-256 hashes and never displayed.</p>
        </div></div>
        {filtered && <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => { setLabel(""); setValueKind(""); setSource(""); }}
        >
          <Undo2 size={14} /> Clear filters
        </button>}
      </div>

      <div className="users-toolbar risk-filters">
        <Select
          label="Filter evidence label"
          value={label}
          onChange={v => setLabel(v)}
          width={180}
          options={[{ value: "", label: "All labels" }, ...LABELS.map(l => ({ value: l, label: l }))]}
        />
        <Select
          label="Filter evidence value kind"
          value={valueKind}
          onChange={v => setValueKind(v)}
          width={160}
          options={[{ value: "", label: "All value kinds" }, ...VALUE_KINDS.map(k => ({ value: k, label: k }))]}
        />
        <Select
          label="Filter evidence source"
          value={source}
          onChange={v => setSource(v)}
          width={130}
          options={[{ value: "", label: "All sources" }, ...SOURCES.map(s => ({ value: s, label: s }))]}
        />
        <span className="cell-muted risk-filter-note">Label and value kind match exactly.</span>
      </div>

      {status === "loading" && <div className="risk-loading-centered"><Loader2 size={24} className="spin" /> <span>Loading evidence ledger…</span></div>}
      {status === "error" && <div className="risk-loading-centered"><AlertTriangle size={24} /> <span>{error}</span></div>}

      {status === "ready" && <>
        <div className="risk-summary">
          <span><b>{formatCount(total)}</b> evidence rows</span>
          <span><b>{formatCount(rows.reduce((sum, row) => sum + row.eventCount, 0))}</b> events on this page</span>
          <span><b>{formatCount(rows.reduce((sum, row) => sum + row.requestCount, 0))}</b> requests on this page</span>
          <span><b>{formatCount(rows.reduce((sum, row) => sum + row.flaggedAccountCount, 0))}</b> flagged accounts on this page</span>
        </div>

        <div className="model-table-wrap">
          <table className="model-table">
            <thead><tr>
              <th style={{whiteSpace:"nowrap"}}>Evidence</th><th style={{whiteSpace:"nowrap"}}>Kind</th><th style={{whiteSpace:"nowrap"}}>Accounts</th><th style={{whiteSpace:"nowrap"}}>IPs</th><th style={{whiteSpace:"nowrap"}}>Keys</th><th style={{whiteSpace:"nowrap"}}>Requests</th><th style={{whiteSpace:"nowrap"}}>Flagged</th><th style={{whiteSpace:"nowrap"}}>Events</th><th style={{whiteSpace:"nowrap"}}>Weight</th><th style={{whiteSpace:"nowrap"}}>Last seen</th>
            </tr></thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={10}>
                    <div className="table-empty">
                      <Layers size={20} /><strong>No evidence rows</strong>
                      <p>{filtered ? "No ledger row matches these filters." : "Evidence appears as signup assessments and gateway requests are recorded."}</p>
                    </div>
                  </td></tr>
                : rows.map(row => <tr key={row.id}>
                    <td>
                      <strong>{row.label}</strong>
                      <span className="cell-sub">
                        {row.valueDisplay ?? <span title="Stored as a hash; the raw value is never displayed">{shortHash(row.valueHash)}</span>}
                      </span>
                    </td>
                    <td><code>{row.valueKind}</code></td>
                    <td className="cell-num">{formatCount(row.distinctAccountCount)}</td>
                    <td className="cell-num">{formatCount(row.distinctIpCount)}</td>
                    <td className="cell-num">{formatCount(row.distinctKeyCount)}</td>
                    <td className="cell-num">{formatCount(row.requestCount)}</td>
                    <td className="cell-num">{row.flaggedAccountCount > 0
                      ? <span className="outcome-pill outcome-error">{formatCount(row.flaggedAccountCount)}</span>
                      : "0"}</td>
                    <td className="cell-num">{formatCount(row.eventCount)}</td>
                    <td className="cell-num">{row.riskWeight}</td>
                    <td className="cell-muted">{stamp(row.lastSeenAt)}</td>
                  </tr>)}
            </tbody>
          </table>
        </div>

        <Pager
          page={report?.page ?? 1}
          perPage={limit}
          total={total}
          totalPages={totalPages}
          onPage={pageNo => void load(pageNo)}
          busy={false}
        />
      </>}
    </div>

    <div className="table-note">
      <Globe2 size={13} /> Evidence is global and read-only here; action is always per account, on the tabs above.
    </div>
  </>;
}
