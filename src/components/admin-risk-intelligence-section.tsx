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

type FlaggedAccount = {
  userId: string;
  email: string;
  flagSource: "signup" | "manual" | string;
  reason: string | null;
  freeTokensUsed: number;
  penaltyStatus: "pending" | "penalized" | string;
  plan: string;
  status: string;
  credits: string;
};

type FlaggedReport = {
  accounts: FlaggedAccount[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  penaltyLimit: number;
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
type Tab = "signup" | "evidence" | "flagged";

/* ---------------------------------------------------------------- helpers */

const SIGNUP_PAGE_SIZE = 50;
const EVIDENCE_PAGE_SIZE = 50;

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
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ signup: true, evidence: false, flagged: false });
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
        <span className="section-index">03</span>
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
      <button type="button" {...tabProps("flagged")}><Flag size={14} /> Flagged accounts</button>
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

    <div
      id="risk-panel-flagged"
      role="tabpanel"
      aria-labelledby="risk-tab-flagged"
      hidden={tab !== "flagged"}
    >
      {visited.flagged && <FlaggedAccountsPanel refreshKey={refreshKey} />}
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
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reviewMenuFor, setReviewMenuFor] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [reassessing, setReassessing] = useState(false);
  const [reasonPopup, setReasonPopup] = useState<{ email: string; tier?: string; items: { reason: string; rule?: string }[] } | null>(null);
  const [ipPopup, setIpPopup] = useState<{ email: string; title: string; ips: string[]; shared?: boolean } | null>(null);

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
  }, [getToken, search, categoryFilter]);

  useEffect(() => { void load(1); }, [load, refreshKey]);

  const reassess = async () => {
    setReassessing(true);
    setNotice(null);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk/reassess", {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setNotice({ kind: "error", text: "Re-evaluation failed." }); return; }
      const data = await res.json();
      setNotice({ kind: "ok", text: `Re-evaluated ${data.evaluated ?? 0} account(s) — ${data.derived ?? 0} derived, ${data.failed ?? 0} failed.` });
      await load(page);
    } catch {
      setNotice({ kind: "error", text: "Could not reach the backend." });
    } finally {
      setReassessing(false);
    }
  };

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

  const flagEligible = async () => {
    setConfirmBulk(false);
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
      await load(page);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBulkBusy(false); }
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
  const eligibleOnPage = rows.filter(row => row.unifiedDecision?.eligible).length;

  return <>
    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status">
      <ShieldAlert size={14} />{notice.text}
    </p>}

    <div className="admin-risk-subsection">
      <div className="section-title-row">
        <div><div>
          <h3>Account assessments</h3>
          <p>Full assessment view for standard accounts: signup score, gateway usage score and unified eligibility. Flag management lives in Flagged accounts.</p>
        </div></div>
      </div>
      <div className="accounts-actions-row">
        <button className="button button-outline compact-button" type="button" onClick={() => setConfirmBulk(true)} disabled={bulkBusy}>
          <Flag size={14} />{bulkBusy ? "Flagging…" : "Flag eligible accounts"}
        </button>
        <button className="button button-ink compact-button" type="button" onClick={() => void reassess()} disabled={reassessing} title="Re-evaluate all signup risk scores">
          {reassessing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {reassessing ? "Updating…" : "Update scores"}
        </button>
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
      </div>

      {status === "loading" && <div className="risk-loading-centered"><Loader2 size={24} className="spin" /> <span>Loading account assessments…</span></div>}
      {status === "error" && <div className="risk-loading-centered"><AlertTriangle size={24} /> <span>{error}</span></div>}

      {status === "ready" && <>
        <div className="risk-summary">
          <span><b>{formatCount(report?.total ?? 0)}</b> assessments</span>
          <span><b>{formatCount(eligibleOnPage)}</b> eligible for review</span>
        </div>

        <div className="model-table-wrap">
          <table className="model-table usage-table accounts-table">
            <thead><tr>
              <th style={{whiteSpace:"nowrap",minWidth:"100px"}}>Account</th><th style={{whiteSpace:"nowrap"}}>Plan</th><th style={{whiteSpace:"nowrap"}}>Score</th><th style={{whiteSpace:"nowrap"}}>Category</th><th style={{whiteSpace:"nowrap"}}>Reasons</th><th style={{whiteSpace:"nowrap",minWidth:"110px"}}>Gateway</th><th style={{whiteSpace:"nowrap"}}>IPs</th><th style={{whiteSpace:"nowrap"}}>Shared IPs</th><th style={{whiteSpace:"nowrap"}}>Keys</th><th style={{whiteSpace:"nowrap"}}>Usage score</th><th style={{whiteSpace:"nowrap"}}>Requests</th><th style={{whiteSpace:"nowrap"}}>Eligible</th><th style={{whiteSpace:"nowrap"}}>Free tokens</th><th style={{whiteSpace:"nowrap"}}>Evaluated</th><th style={{whiteSpace:"nowrap"}}>Action</th>
            </tr></thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={15}>
                    <div className="table-empty">
                      <Users size={20} /><strong>No assessments found</strong>
                      <p>Try changing the search or filters.</p>
                    </div>
                  </td></tr>
                : rows.map(row => {
                  const reasons = row.riskReasons ?? [];
                  const rules = row.matchedRules ?? [];
                  const ud = row.unifiedDecision;
                  const gs = row.gatewayStats;
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
                    <td>
                      {(ud?.usage?.tier == null || ud?.usage?.tier === "not_assessed") && (!gs?.reasons || gs.reasons.length === 0)
                        ? <span className="cell-muted">—</span>
                        : <button 
                            className={`risk-icon-btn risk-tier-${ud?.usage?.tier ?? "neutral"}`} 
                            type="button" 
                            title={`Gateway tier: ${ud?.usage?.tier ?? "not assessed"}${gs?.reasons?.length ? ` — ${gs.reasons.length} reason(s)` : ""}`}
                            onClick={() => setReasonPopup({ 
                              email: row.email, 
                              tier: ud?.usage?.tier, 
                              items: (gs?.reasons ?? []).map((r) => ({ reason: r })) 
                            })}
                          >
                            <AlertTriangle size={13} /> {gs?.reasons?.length ?? 0}
                          </button>}
                    </td>
                    <td className="cell-num">
                      {gs?.distinctIpCount
                        ? <button className="risk-ip-count" type="button" onClick={() => setIpPopup({ email: row.email, title: "Distinct IPs", ips: gs.ips })}>{gs.distinctIpCount}</button>
                        : "—"}
                    </td>
                    <td className="cell-num">
                      {gs?.sharedIpCount
                        ? <button className="risk-ip-count risk-ip-shared" type="button" onClick={() => setIpPopup({ email: row.email, title: "Shared IPs", ips: gs.sharedIps, shared: true })}>{gs.sharedIpCount}</button>
                        : "—"}
                    </td>
                    <td className="cell-num">{gs?.apiKeyCount ?? "—"}</td>
                    <td className="cell-num">{ud?.usage?.score == null ? "—" : ud.usage.score}</td>
                    <td className="cell-num">{ud?.usage?.requestCount ?? "—"}</td>
                    <td>{ud?.eligible ? <span className="outcome-pill outcome-warn">yes</span> : <span className="cell-muted">—</span>}</td>
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
      open={confirmBulk}
      title="Flag eligible accounts"
      subtitle="All currently unflagged accounts whose latest risk assessment is high_risk or review_required will be flagged. This is a label only — it does not change their allowance."
      onClose={() => setConfirmBulk(false)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setConfirmBulk(false)} disabled={bulkBusy}>Cancel</button>
        <button className="button compact-button" type="button" onClick={() => void flagEligible()} disabled={bulkBusy}>
          {bulkBusy ? <Loader2 size={14} className="spin" /> : <Flag size={14} />} Flag eligible
        </button>
      </>}
    >
      <p className="modal-note">Each account is flagged individually. No domain, IP, or cluster cascade is performed.</p>
    </Modal>

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

    <Modal
      open={ipPopup !== null}
      title={ipPopup ? `${ipPopup.title} — ${ipPopup.email}` : "IPs"}
      onClose={() => setIpPopup(null)}
      footer={<button className="button button-ink compact-button" type="button" onClick={() => setIpPopup(null)}>Close</button>}
    >
      {ipPopup && <div className="risk-ip-popup">
        {ipPopup.ips.length === 0
          ? <p className="modal-note">No IPs recorded.</p>
          : ipPopup.ips.map((ip, i) => <div key={i} className={`risk-ip-row${ipPopup.shared ? " risk-ip-row-shared" : ""}`}>
              <code>{ip}</code>
            </div>)}
      </div>}
    </Modal>
  </>;
}

/* ---------------------------------------------------------- flagged side */

function FlaggedAccountsPanel({ refreshKey }: { refreshKey: number }) {
  const { getToken } = useAuth();
  const [report, setReport] = useState<FlaggedReport | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmPenalty, setConfirmPenalty] = useState(false);
  const [confirmClear, setConfirmClear] = useState<FlaggedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (pageNo: number) => {
    setStatus("loading");
    try {
      const token = await getToken();
      const params = new URLSearchParams({ page: String(pageNo), limit: "50" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/backend/api/v1/admin/users/risk/flagged?${params.toString()}`, { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) { setError(errorFor(res.status, "flagged accounts")); setStatus("error"); return; }
      const data = await res.json() as FlaggedReport;
      setReport({ accounts: Array.isArray(data.accounts) ? data.accounts : [], page: Number(data.page ?? pageNo), perPage: Number(data.perPage ?? 15), total: Number(data.total ?? 0), totalPages: Number(data.totalPages ?? 1), penaltyLimit: Number(data.penaltyLimit ?? 19500000) });
      setStatus("ready");
    } catch { setError("Could not reach the backend."); setStatus("error"); }
  }, [getToken, search]);

  useEffect(() => { void load(1); }, [load, refreshKey]);

  const applyPenalties = async () => {
    setConfirmPenalty(false); setBusy(true); setNotice(null);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk/flagged/apply-penalties", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" } });
      const body = await res.json().catch(() => null) as { totalFlagged?: number; penalizedNow?: number; alreadyPenalized?: number; skipped?: number; errors?: number; error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not apply pending penalties." }); return; }
      setNotice({ kind: "ok", text: `${body?.penalizedNow ?? 0} of ${body?.totalFlagged ?? 0} flagged accounts penalized. ${body?.alreadyPenalized ?? 0} already penalized. ${(body?.skipped ?? 0) + (body?.errors ?? 0)} skipped.` });
      await load(report?.page ?? 1);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusy(false); }
  };

  const clearFlag = async (row: FlaggedAccount) => {
    setConfirmClear(null); setBusyId(row.userId); setNotice(null);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk/flagged/clear", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ userId: row.userId }) });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not clear the flag." }); return; }
      setNotice({ kind: "ok", text: `${row.email} unflagged and free-token usage reset.` });
      await load(report?.page ?? 1);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setBusyId(null); }
  };

  const accounts = report?.accounts ?? [];
  return <>
    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status"><ShieldAlert size={14} />{notice.text}</p>}
    <div className="admin-risk-subsection">
      <div className="section-title-row"><div><div><h3>Flagged accounts</h3><p>All signup and manual flags. Unflagging resets free-token usage to zero; status and paid lanes are unchanged.</p></div></div></div>
      <div className="accounts-actions-row">
        <button className="button compact-button" type="button" onClick={() => setConfirmPenalty(true)} disabled={busy || status !== "ready"}><Flag size={14} />{busy ? "Applying…" : "Apply pending penalties"}</button>
      </div>
      <div className="users-toolbar risk-filters">
        <label className="search-field">
          <Search size={14} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search flagged email or name" aria-label="Search flagged accounts" />
        </label>
      </div>
      {status === "loading" && <div className="risk-loading-centered"><Loader2 size={24} className="spin" /> <span>Loading flagged accounts…</span></div>}
      {status === "error" && <div className="risk-loading-centered"><AlertTriangle size={24} /> <span>{error}</span></div>}
      {status === "ready" && <>
        <div className="risk-summary"><span><b>{formatCount(report?.total ?? 0)}</b> flagged accounts</span><span><b>{formatCount(accounts.filter(a => a.penaltyStatus === "pending").length)}</b> pending on this page</span><span><b>{formatCount(accounts.filter(a => a.penaltyStatus === "penalized").length)}</b> penalized on this page</span></div>
        <div className="model-table-wrap"><table className="model-table accounts-table"><thead><tr><th>Account</th><th>Flag</th><th>Reason</th><th>Free tokens</th><th>Penalty</th><th>Status</th><th>Plan</th><th>Action</th></tr></thead><tbody>{accounts.length === 0 ? <tr><td colSpan={8}><div className="table-empty"><Users size={20} /><strong>No flagged accounts</strong><p>Accounts flagged by signup or manual review appear here.</p></div></td></tr> : accounts.map(row => <tr key={row.userId}><td><strong>{row.email}</strong></td><td><span className={`outcome-pill ${row.flagSource === "signup" ? "outcome-error" : "outcome-interrupted"}`}>{row.flagSource}</span></td><td><span className="cell-sub">{row.reason ?? "—"}</span></td><td className="cell-num">{formatCount(row.freeTokensUsed)} / 20M</td><td><span className={`outcome-pill ${row.penaltyStatus === "pending" ? "outcome-interrupted" : "outcome-ok"}`}>{row.penaltyStatus}</span></td><td>{row.status}</td><td>{row.plan}</td><td><button className="row-action row-action-danger" type="button" aria-label={`Unflag ${row.email}`} title="Unflag and reset free-token usage" onClick={() => setConfirmClear(row)} disabled={busyId === row.userId}><Undo2 size={14}/></button></td></tr>)}</tbody></table></div>
        <Pager page={report?.page ?? 1} perPage={report?.perPage ?? 50} total={report?.total ?? 0} totalPages={report?.totalPages ?? 1} onPage={page => void load(page)} busy={busy} />
      </>}
    </div>
    <div className="table-note"><AlertTriangle size={13} /> Unflag clears the badge and resets free_tokens_used to zero for this account only. Credits, subscription, top-up, status and API access are preserved.</div>
    <Modal open={confirmPenalty} title="Apply pending penalties" subtitle="Raise every flagged account below 19.5M free tokens to the penalty threshold. Already-penalized accounts remain unchanged." onClose={() => setConfirmPenalty(false)} footer={<><button className="button button-outline compact-button" type="button" onClick={() => setConfirmPenalty(false)} disabled={busy}>Cancel</button><button className="button compact-button" type="button" onClick={() => void applyPenalties()} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Flag size={14} />} Apply penalties</button></>}><p className="modal-note">Each flagged account is handled independently.</p></Modal>
    <Modal open={confirmClear !== null} title={confirmClear ? `Unflag ${confirmClear.email}?` : "Unflag account"} subtitle="This clears the flag and resets free-token usage to zero." onClose={() => setConfirmClear(null)} footer={<><button className="button button-outline compact-button" type="button" onClick={() => setConfirmClear(null)} disabled={busyId !== null}>Cancel</button><button className="button compact-button" type="button" onClick={() => confirmClear && void clearFlag(confirmClear)} disabled={busyId !== null}>{busyId ? <Loader2 size={14} className="spin" /> : <Undo2 size={14} />} Unflag and reset</button></>}><p className="modal-note">The account stays ACTIVE; credits, subscription, top-up and API access are preserved.</p></Modal>
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
