"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Activity, Check, Gauge, Info, Loader2, RefreshCw, Save, Users, X } from "lucide-react";
import { formatTokens } from "@/lib/tokens";

type LimitRow = {
  plan: string;
  rpm: number | null;
  tpm: number | null;
  limited: boolean;
  updatedAt: string | null;
};

type UsageRow = { email: string; plan: string; requests: number; tokens: number };

/** What each plan means, so the operator does not have to remember the enum. */
const PLAN_NOTE: Record<string, string> = {
  STANDARD: "The plan a new account lands on. Unlimited unless you say otherwise.",
  SUBSCRIPTION: "Paying accounts. The tier rate limits exist for.",
  SUPERUSER: "You. Never throttled by accident, never charged.",
};

export function AdminRateLimitsPage() {
  const { getToken } = useAuth();
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [accounts, setAccounts] = useState<Record<string, number>>({});
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Draft values, keyed by plan, so an edit is local until it is saved.
  const [draft, setDraft] = useState<Record<string, { rpm: string; tpm: string }>>({});

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const headers = await authHeaders();
      const [limRes, useRes] = await Promise.all([
        fetch("/backend/api/v1/admin/rate-limits", { headers, cache: "no-store" }),
        fetch("/backend/api/v1/admin/rate-limits/usage", { headers, cache: "no-store" }),
      ]);
      if (!limRes.ok) { setStatus("error"); return; }
      const limData = await limRes.json() as { limits?: LimitRow[]; accounts?: Record<string, number> };
      const rows = Array.isArray(limData.limits) ? limData.limits : [];
      setLimits(rows);
      setAccounts(limData.accounts ?? {});
      setDraft(Object.fromEntries(rows.map(r => [r.plan, {
        rpm: r.rpm === null ? "" : String(r.rpm),
        tpm: r.tpm === null ? "" : String(r.tpm),
      }])));
      if (useRes.ok) {
        const useData = await useRes.json() as { usage?: UsageRow[] };
        setUsage(Array.isArray(useData.usage) ? useData.usage : []);
      }
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const save = async (plan: string) => {
    const d = draft[plan];
    if (!d) return;
    setBusyPlan(plan);
    setNotice(null);
    try {
      const res = await fetch(`/backend/api/v1/admin/rate-limits/${plan}`, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ rpm: d.rpm.trim(), tpm: d.tpm.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not save the limits." });
        return;
      }
      const cleared = d.rpm.trim() === "" && d.tpm.trim() === "";
      setNotice({ kind: "ok", text: cleared ? `${plan} is now unlimited.` : `${plan} limits updated.` });
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyPlan(null);
    }
  };

  const setField = (plan: string, key: "rpm" | "tpm", value: string) =>
    setDraft(d => ({ ...d, [plan]: { ...d[plan], [key]: value.replace(/[^\d]/g, "") } }));

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Gauge size={14}/> ADMIN / RATE LIMITS</div>
        <h1>Rate limits</h1>
        <p>Per-minute ceilings, by plan. A plan with both fields empty is unlimited.</p>
      </div>
    </div>

    {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
      {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
    </p>}

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Limits by plan</h2><p>Requests and tokens, per account, per minute.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void load()}><RefreshCw size={15}/> Refresh</button>
      </div>

      {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading limits…</strong></div>}
      {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load limits</strong></div>}

      {status === "ready" && <div className="limit-grid">
        {limits.map(row => {
          const d = draft[row.plan] ?? { rpm: "", tpm: "" };
          const dirty = d.rpm !== (row.rpm === null ? "" : String(row.rpm))
            || d.tpm !== (row.tpm === null ? "" : String(row.tpm));
          const holders = accounts[row.plan] ?? 0;
          return <article key={row.plan} className={row.limited ? "limit-card limit-card-on" : "limit-card"}>
            <div className="limit-card-head">
              <strong>{row.plan}</strong>
              <span className={row.limited ? "limit-state limit-state-on" : "limit-state"}>{row.limited ? "Limited" : "Unlimited"}</span>
            </div>
            <p className="limit-note">{PLAN_NOTE[row.plan] ?? ""}</p>
            <div className="limit-holders"><Users size={13}/> {holders} account{holders === 1 ? "" : "s"}</div>

            <div className="limit-fields">
              <label className="limit-field">
                <span>Requests / min</span>
                <input inputMode="numeric" placeholder="∞" value={d.rpm}
                  onChange={e => setField(row.plan, "rpm", e.target.value)}/>
              </label>
              <label className="limit-field">
                <span>Tokens / min</span>
                <input inputMode="numeric" placeholder="∞" value={d.tpm}
                  onChange={e => setField(row.plan, "tpm", e.target.value)}/>
              </label>
            </div>

            <div className="limit-card-foot">
              <span className="limit-hint">
                {d.rpm === "" && d.tpm === "" ? "Unlimited" : `${d.rpm || "∞"} req · ${formatTokens(Number(d.tpm || 0))} tok per minute`}
              </span>
              <button className="button button-ink compact-button" type="button"
                disabled={!dirty || busyPlan !== null} onClick={() => void save(row.plan)}>
                {busyPlan === row.plan ? <><Loader2 size={13} className="row-spinner"/> Saving…</> : <><Save size={13}/> Save</>}
              </button>
            </div>
          </article>;
        })}
      </div>}

      <div className="table-note"><Info size={14}/> Limits apply per account, not per API key — a new key does not buy a new allowance.</div>
    </section>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>This minute</h2><p>Accounts with traffic in the current window.</p></div></div>
      </div>
      {usage.length === 0
        ? <div className="table-empty"><Activity size={19}/><strong>No traffic this minute</strong><p>Only limited plans are counted, so this stays empty on an unlimited workspace.</p></div>
        : <div className="model-table-wrap">
            <table className="model-table table-events">
              <thead><tr><th>ACCOUNT</th><th>PLAN</th><th>REQUESTS</th><th>TOKENS</th></tr></thead>
              <tbody>{usage.map(r => <tr key={r.email}>
                <td>{r.email}</td>
                <td><span className="kind-tag">{r.plan}</span></td>
                <td className="cell-num">{r.requests.toLocaleString()}</td>
                <td className="cell-num">{formatTokens(r.tokens)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </div>;
}
