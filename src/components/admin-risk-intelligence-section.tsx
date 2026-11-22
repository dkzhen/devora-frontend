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
  Search, ShieldAlert, ShieldCheck, Trash2, Undo2, Users,
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
  const { getToken } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [purging, setPurging] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    normal: number;
    suspicious: number;
    elevated: number;
    highRisk: number;
    reviewRequired: number;
    notAssessed: number;
    flagged: number;
  } | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/admin/users/risk?limit=1`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) { setError(errorFor(res.status, "signup risk summary")); setStatus("error"); return; }
      const data = await res.json() as SignupReport;
      const tally = (data as unknown as { tally?: { risk_category: string; n: string; flagged: string }[] }).tally ?? [];
      const find = (cat: string) => Number(tally.find(t => t.risk_category === cat)?.n ?? 0);
      const flaggedTotal = tally.reduce((sum, t) => sum + Number(t.flagged ?? 0), 0);
      setSummary({
        total: Number(data.total ?? 0),
        normal: find("normal"),
        suspicious: find("suspicious"),
        elevated: find("elevated"),
        highRisk: find("high_risk"),
        reviewRequired: find("review_required"),
        notAssessed: find("not_assessed"),
        flagged: flaggedTotal,
      });
      setStatus("ready");
    } catch { setError("Could not reach the backend."); setStatus("error"); }
  }, [getToken]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const purge = async () => {
    setPurging(true);
    setNotice(null);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/admin/users/risk-evidence/purge", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const body = await res.json().catch(() => null) as { removedEvents?: number; removedLedger?: number; error?: { message?: string } } | null;
      if (!res.ok) { setNotice({ kind: "error", text: body?.error?.message ?? "Could not purge." }); return; }
      setNotice({ kind: "ok", text: `Purged ${formatCount(body?.removedEvents ?? 0)} events and ${formatCount(body?.removedLedger ?? 0)} ledger rows older than 7 days.` });
      setConfirmPurge(false);
      setRefreshKey(key => key + 1);
    } catch { setNotice({ kind: "error", text: "Could not reach the backend." }); }
    finally { setPurging(false); }
  };

  return <section className="console-section risk-intel">
    <div className="section-title-row">
      <div>
        <span className="section-index">04</span>
        <div>
          <h2>Risk intelligence</h2>
          <p>Signup risk assessment counts. Evidence auto-purges after 7 days; flagging is automatic.</p>
        </div>
      </div>
      <div className="reputation-actions">
        <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => setRefreshKey(key => key + 1)}
          disabled={status === "loading"}
        >
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          className="button button-outline compact-button"
          type="button"
          onClick={() => setConfirmPurge(true)}
          disabled={status !== "ready"}
          title="Delete risk evidence older than 7 days"
        >
          <Trash2 size={14} /> Purge old
        </button>
      </div>
    </div>

    {notice && <p className={`voucher-message ${notice.kind === "ok" ? "voucher-ok" : "voucher-error"}`} role="status">
      {notice.kind === "ok" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}{notice.text}
    </p>}

    {status === "loading" && <div className="risk-loading-centered"><Loader2 size={24} className="spin" /> <span>Loading signup risk summary…</span></div>}
    {status === "error" && <div className="risk-loading-centered"><AlertTriangle size={24} /> <span>{error}</span></div>}
    {status === "ready" && summary && (
      <div className="risk-count-grid">
        <div className="risk-count-card risk-count-total">
          <span className="risk-count-label">Total assessed</span>
          <strong className="risk-count-value">{formatCount(summary.total)}</strong>
        </div>
        <div className="risk-count-card risk-count-ok">
          <span className="risk-count-label">Normal</span>
          <strong className="risk-count-value">{formatCount(summary.normal)}</strong>
        </div>
        <div className="risk-count-card risk-count-warn">
          <span className="risk-count-label">Suspicious</span>
          <strong className="risk-count-value">{formatCount(summary.suspicious)}</strong>
        </div>
        <div className="risk-count-card risk-count-warn">
          <span className="risk-count-label">Elevated</span>
          <strong className="risk-count-value">{formatCount(summary.elevated)}</strong>
        </div>
        <div className="risk-count-card risk-count-danger">
          <span className="risk-count-label">High risk</span>
          <strong className="risk-count-value">{formatCount(summary.highRisk)}</strong>
        </div>
        <div className="risk-count-card risk-count-danger">
          <span className="risk-count-label">Review required</span>
          <strong className="risk-count-value">{formatCount(summary.reviewRequired)}</strong>
        </div>
        <div className="risk-count-card risk-count-muted">
          <span className="risk-count-label">Not assessed</span>
          <strong className="risk-count-value">{formatCount(summary.notAssessed)}</strong>
        </div>
        <div className="risk-count-card risk-count-flagged">
          <span className="risk-count-label">Flagged</span>
          <strong className="risk-count-value">{formatCount(summary.flagged)}</strong>
        </div>
      </div>
    )}
    <div className="table-note">
      <AlertTriangle size={13} /> Risk scores are computed at signup. Evidence auto-purges after 7 days. Flagged accounts are excluded from the free-token roll.
    </div>

    <Modal
      open={confirmPurge}
      tone="danger"
      title="Purge old risk evidence"
      subtitle="Deletes evidence events and ledger rows older than 7 days. This cannot be undone."
      busy={purging}
      onClose={() => setConfirmPurge(false)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setConfirmPurge(false)} disabled={purging}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => void purge()} disabled={purging}>
          {purging ? <><Loader2 size={13} className="row-spinner" /> Purging…</> : "Purge"}
        </button>
      </>}
    >
      <div className="modal-danger-note"><AlertTriangle size={15} />
        <span>This removes risk evidence older than 7 days from <strong>risk_evidence_events</strong> and <strong>risk_evidence_ledger</strong>. Signup scores on user accounts are not affected.</span>
      </div>
    </Modal>
  </section>;
}
