"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle, Ban, Check, Gift, Loader2, Plus, RefreshCw, Tag, Ticket, X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { formatCredits } from "@/lib/credits";

/**
 * Vouchers.
 *
 * Two audiences on one page, chosen by the account's own plan:
 *
 *  - Everyone sees the redeem box and their own redemption history.
 *  - A SUPERUSER additionally sees the mint card and the full list of codes.
 *
 * The plan check here is presentation only. Every mint, list and disable request is
 * re-authorized server-side from the database plan — hiding the card is a courtesy, not a
 * control, and the page says so rather than implying otherwise.
 */

type Redemption = {
  code: string;
  label: string;
  credits: string;
  redeemedAt: string;
  ref: string | null;
};

type Voucher = {
  id: string;
  code: string;
  label: string;
  /** What each redeemer receives. `fundedTotal / maxUses`, fixed at creation. */
  perUser: string;
  /** The pool the operator paid for. */
  fundedTotal: string;
  maxUses: number;
  uses: number;
  /** Still held in the pool — what a claim would return. */
  remaining: string;
  claimedBack: string;
  expiresAt: string | null;
  disabled: boolean;
  createdBy: string;
  createdAt: string;
  claimedAt: string | null;
  /** Whether the pool can be taken back right now. Decided by the backend. */
  claimable: boolean;
  /** "credits" = a pool; "subscription" = grants a package. */
  kind: "credits" | "subscription";
  packageId: string | null;
  packageName: string | null;
  state: "active" | "disabled" | "expired" | "exhausted" | "closed";
};

type PackageOption = { id: string; name: string; category: string; tier: string };

type Status = "idle" | "loading" | "ready" | "error";

/** Drop trailing zeros from a credit string: "1.200000" -> "1.2". */
const trim = (v: string): string => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

const stamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/** Codes are minted from a label, so the common case is one click and no typing. */
function suggestCode(label: string): string {
  const slug = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug ? `DEVORA-${slug}`.slice(0, 64) : "";
}

/**
 * The split a draft would produce, and whether the operator can afford it.
 *
 * Shown before the button is pressed because the pool is paid for out of the operator's own
 * balance — committing is a spend, and the arithmetic is the part they would otherwise have
 * to do in their head.
 */
function splitPreview(credits: string, maxUses: string, balance: string): string {
  const c = Number(credits);
  const n = Number(maxUses);
  if (credits.trim() === "" || maxUses.trim() === "") {
    return "Each redeemer gets an equal share of the pool.";
  }
  if (!Number.isFinite(c) || c <= 0) return "Credits must be a positive number.";
  if (!Number.isInteger(n) || n < 1) return "Max users must be a whole number, at least 1.";
  const per = c / n;
  const short = c > Number(balance);
  return `${c} credits ÷ ${n} users = ${per.toFixed(6)} each` +
    (short ? ` — but your balance is only ${trim(balance)}. Fund your account first.` : "");
}

export default function VouchersPage() {
  const { getToken } = useAuth();
  const [isOperator, setIsOperator] = useState(false);

  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  const [history, setHistory] = useState<Redemption[]>([]);
  const [historyStatus, setHistoryStatus] = useState<Status>("loading");

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherStatus, setVoucherStatus] = useState<Status>("idle");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Success line for operator actions, separate from the redeem message. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Operator's own balance — shown because minting spends it. */
  const [balance, setBalance] = useState("0");

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
  }, [getToken]);

  /** Who am I — decides whether the operator sections are rendered at all. */
  const loadIdentity = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) return;
      const data = await res.json() as { user?: { plan?: unknown; credits?: unknown } };
      setIsOperator(data.user?.plan === "SUPERUSER");
      if (typeof data.user?.credits === "string") setBalance(data.user.credits);
    } catch { /* the redeem box still works without knowing the plan */ }
  }, [getToken]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/vouchers/mine", { headers: await authHeaders() });
      if (!res.ok) { setHistoryStatus("error"); return; }
      const data = await res.json() as { redemptions?: Redemption[] };
      setHistory(Array.isArray(data.redemptions) ? data.redemptions : []);
      setHistoryStatus("ready");
    } catch {
      setHistoryStatus("error");
    }
  }, [authHeaders]);

  const loadVouchers = useCallback(async () => {
    setVoucherStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/vouchers", { headers: await authHeaders() });
      // 404 is what a non-operator gets — the route deliberately reports as "not found"
      // rather than "forbidden", so an admin tier is not discoverable by probing.
      if (!res.ok) { setVoucherStatus("error"); return; }
      const data = await res.json() as { vouchers?: Voucher[] };
      setVouchers(Array.isArray(data.vouchers) ? data.vouchers : []);
      setVoucherStatus("ready");
    } catch {
      setVoucherStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void loadIdentity(); void loadHistory(); }, [loadIdentity, loadHistory]);
  useEffect(() => { if (isOperator) void loadVouchers(); }, [isOperator, loadVouchers]);

  const redeem = async () => {
    const value = code.trim().toUpperCase();
    if (!value) { setMessage({ kind: "error", text: "Enter a voucher code first." }); return; }
    setRedeeming(true);
    setMessage(null);
    try {
      const res = await fetch("/backend/api/v1/vouchers/redeem", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ code: value }),
      });
      const body = await res.json().catch(() => null) as
        { label?: string; credits?: string; balance?: string; ref?: string; error?: { message?: string } } | null;
      if (!res.ok) { setMessage({ kind: "error", text: body?.error?.message ?? "Could not redeem the voucher." }); return; }
      setMessage({
        kind: "ok",
        text: `${body?.credits ? trim(body.credits) : ""} credits added from ${body?.label ?? value}` +
              (body?.ref ? ` · ${body.ref}` : ""),
      });
      setCode("");
      await loadHistory();
      if (isOperator) await loadVouchers();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setRedeeming(false);
    }
  };

  const [creating, setCreating] = useState(false);
  // No code field: the backend generates it. An operator-chosen code is a namespace they
  // can collide in, and the collision is a dead end for someone who just wants a voucher.
  const [draft, setDraft] = useState<{ label: string; kind: "credits" | "subscription"; credits: string; maxUses: string; expiresAt: string; packageId: string }>(
    { label: "", kind: "credits", credits: "", maxUses: "", expiresAt: "", packageId: "" });
  const [createError, setCreateError] = useState("");
  const [packages, setPackages] = useState<PackageOption[]>([]);

  useEffect(() => {
    if (!isOperator) return;
    void (async () => {
      try {
        const res = await fetch("/backend/api/v1/admin/packages", { headers: await authHeaders(), cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { packages?: PackageOption[] };
        setPackages(Array.isArray(data.packages) ? data.packages : []);
      } catch { /* the mint card still works for credit vouchers */ }
    })();
  }, [isOperator, authHeaders]);

  const create = async () => {
    setCreateError("");
    const maxUses = Number(draft.maxUses);
    if (!draft.label.trim()) { setCreateError("Label is required."); return; }
    if (!Number.isInteger(maxUses) || maxUses < 1) { setCreateError("Max users must be a whole number, at least 1."); return; }
    if (draft.kind === "subscription" && !draft.packageId) { setCreateError("Pick the package this voucher grants."); return; }
    const credits = Number(draft.credits);
    if (draft.kind === "credits" && (!Number.isFinite(credits) || credits <= 0)) {
      setCreateError("Credits must be a positive number."); return;
    }
    setCreating(true);
    try {
      const res = await fetch("/backend/api/v1/admin/vouchers", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          label: draft.label.trim(),
          // A subscription voucher names a package and moves no credits; a credit voucher funds
          // a pool. The backend branches on packageId, so send only the one that applies.
          ...(draft.kind === "subscription" ? { packageId: draft.packageId } : { credits }),
          maxUses,
          expiresAt: draft.expiresAt.trim() === "" ? null : draft.expiresAt,
        }),
      });
      const body = await res.json().catch(() => null) as
        { code?: string; perUser?: string; error?: { message?: string } } | null;
      if (!res.ok) { setCreateError(body?.error?.message ?? "Could not create the voucher."); return; }
      setNotice(draft.kind === "subscription"
        ? `Subscription voucher ${body?.code ?? ""} created for ${draft.packageId}.`
        : `Voucher ${body?.code ?? ""} created — ${body?.perUser ?? ""} credits per user.`);
      setDraft({ label: "", kind: "credits", credits: "", maxUses: "", expiresAt: "", packageId: "" });
      await loadVouchers();
      await loadIdentity(); // the operator's own balance was debited (credit vouchers only)
    } catch {
      setCreateError("Could not reach the gateway.");
    } finally {
      setCreating(false);
    }
  };

  const claim = async (v: Voucher) => {
    setBusyId(v.id);
    setNotice(null);
    try {
      const res = await fetch(`/backend/api/v1/admin/vouchers/${v.id}/claim`, {
        method: "POST", headers: await authHeaders(),
      });
      const body = await res.json().catch(() => null) as
        { reclaimed?: string; error?: { message?: string } } | null;
      if (!res.ok) { setMessage({ kind: "error", text: body?.error?.message ?? "Could not claim the pool." }); return; }
      setNotice(`Reclaimed ${trim(body?.reclaimed ?? "0")} credits from ${v.code}.`);
      await loadVouchers();
      await loadIdentity();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

  const toggleDisabled = async (v: Voucher) => {
    setBusyId(v.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/vouchers/${v.id}`, {
        method: "PATCH", headers: await authHeaders(), body: JSON.stringify({ disabled: !v.disabled }),
      });
      if (!res.ok) { setMessage({ kind: "error", text: "Could not update the voucher." }); return; }
      await loadVouchers();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

  return <div className="page-stack">
    <div className="page-heading"><div>
      <div className="eyebrow small-eyebrow"><Tag size={14}/> MAIN / VOUCHERS</div>
      <h1>Vouchers</h1>
      <p>Redeem a code to add credits, or mint codes if you operate the platform.</p>
    </div></div>

    {/* ---------- redeem: every account ---------- */}
    <section className="console-section voucher-redeem">
      <div className="section-title-row"><div><span className="section-index">01</span><div><h2>Redeem a voucher</h2><p>Single-use per account, applied to your balance instantly.</p></div></div></div>
      <div className="voucher-form">
        <label className="voucher-input"><Ticket size={16}/><input aria-label="Voucher code" value={code} onChange={e => { setCode(e.target.value); setMessage(null); }} onKeyDown={e => { if (e.key === "Enter") void redeem(); }} placeholder="Enter your voucher code"/></label>
        <button className="button button-ink" type="button" onClick={() => void redeem()} disabled={redeeming}>
          {redeeming ? <><Loader2 size={16} className="row-spinner"/> Redeeming…</> : <>Redeem <Gift size={16}/></>}
        </button>
      </div>
      {message && <p className={message.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
        {message.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{message.text}
      </p>}
    </section>

    {/* ---------- operator: mint ---------- */}
    {isOperator && <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">02</span><div><h2>Create a voucher</h2><p>Fund a pool from your balance. Each redeemer takes an equal share of it.</p></div></div></div>
      {notice && <p className="voucher-message voucher-ok" role="status"><Check size={14}/> {notice}</p>}
      <div className="voucher-create">
        <label className="admin-field"><span>LABEL</span>
          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Gift credits"/></label>
        <div className="admin-field"><span>TYPE</span>
          <Select
            label="Voucher type"
            value={draft.kind}
            onChange={v => setDraft(d => ({ ...d, kind: v as "credits" | "subscription" }))}
            options={[{ value: "credits", label: "Credits" }, { value: "subscription", label: "Subscription" }]}
          />
          <small>A subscription grants a package; credits fund a pool.</small>
        </div>
        {draft.kind === "subscription"
          ? <div className="admin-field"><span>PACKAGE</span>
              <Select
                label="Package this voucher grants"
                value={draft.packageId}
                onChange={v => setDraft(d => ({ ...d, packageId: v }))}
                placeholder={packages.length === 0 ? "No packages yet" : "Select a package…"}
                disabled={packages.length === 0}
                options={packages.map(p => ({ value: p.id, label: `${p.name} (${p.id})` }))}
              />
              <small>{packages.length === 0 ? "Create one on the Packages page first." : "The allowance each redeemer receives."}</small>
            </div>
          : <label className="admin-field"><span>CREDITS TO FUND</span>
              <input value={draft.credits} onChange={e => setDraft(d => ({ ...d, credits: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="100" inputMode="decimal"/></label>}
        <label className="admin-field"><span>MAX USERS</span>
          <input value={draft.maxUses} onChange={e => setDraft(d => ({ ...d, maxUses: e.target.value.replace(/[^0-9]/g, "") }))} placeholder="10" inputMode="numeric"/></label>
        <label className="admin-field"><span>EXPIRES <small>optional</small></span>
          <input type="date" value={draft.expiresAt} onChange={e => setDraft(d => ({ ...d, expiresAt: e.target.value }))}/></label>
        <div className="voucher-create-actions">
          <button className="button button-ink compact-button" type="button" onClick={() => void create()} disabled={creating}>
            {creating ? <><Loader2 size={13} className="row-spinner"/> Creating…</> : <><Plus size={13}/> {draft.kind === "subscription" ? "Create voucher" : "Create & fund"}</>}
          </button>
          <span className="voucher-balance">Balance <strong>{trim(balance)}</strong></span>
          {createError && <span className="voucher-error voucher-inline-error"><AlertTriangle size={13}/> {createError}</span>}
        </div>
        {/* What the pool works out to before committing to it — the arithmetic is the part
            an operator would otherwise do in their head. A subscription moves no credits, so
            the preview only applies to a credit voucher. */}
        {draft.kind === "credits" && <p className="voucher-split">{splitPreview(draft.credits, draft.maxUses, balance)}</p>}
      </div>
    </section>}

    {/* ---------- operator: list ---------- */}
    {isOperator && <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">03</span><div><h2>All vouchers</h2><p>Every code, with its use count and state.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadVouchers()} disabled={voucherStatus === "loading"}><RefreshCw size={14}/> Refresh</button>
      </div>
      <div className="model-table-wrap">
        {voucherStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading vouchers…</strong><p>Reading the voucher table.</p></div>}
        {voucherStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load vouchers</strong><p>Try refreshing.</p></div>}
        {voucherStatus === "ready" && (vouchers.length === 0
          ? <div className="table-empty"><Tag size={19}/><strong>No vouchers yet</strong><p>Create one above and it will appear here.</p></div>
          : <table className="model-table vouchers-table">
              <thead><tr><th>CODE</th><th>LABEL</th><th>PER USER</th><th>USES</th><th>REMAINING</th><th>EXPIRES</th><th>STATE</th><th></th></tr></thead>
              <tbody>
                {vouchers.map(v => <tr key={v.id}>
                  <td><code className="ref-chip">{v.code}</code></td>
                  <td>{v.label}<small className="cell-sub">by {v.createdBy}</small></td>
                  <td className="cell-num">{v.kind === "subscription"
                    ? <><span className="plan-tag">SUBSCRIPTION</span><small className="cell-sub">{v.packageName ?? v.packageId}</small></>
                    : <>{trim(v.perUser)}<small className="cell-sub">pool {trim(v.fundedTotal)}</small></>}</td>
                  <td className="cell-num">{v.uses}<small className="cell-sub">of {v.maxUses}</small></td>
                  <td className="cell-num">{v.kind === "subscription"
                    ? <span className="cell-none">—</span>
                    : <>{trim(v.remaining)}{v.claimedBack !== "0.000000" && <small className="cell-sub">{trim(v.claimedBack)} claimed</small>}</>}</td>
                  <td className="cell-muted">{v.expiresAt ? stamp(v.expiresAt) : "never"}</td>
                  <td><span className={`outcome-pill state-${v.state}`}>{v.state}</span></td>
                  <td><span className="row-actions">
                    {v.claimable && v.kind === "credits" && <button className="button button-ink compact-button claim-button" type="button" title="Return the unclaimed pool to your balance" onClick={() => void claim(v)} disabled={busyId === v.id}>Claim {trim(v.remaining)}</button>}
                    <button className="row-action" type="button" title={v.disabled ? "Re-enable" : "Disable"} aria-label={`${v.disabled ? "Enable" : "Disable"} ${v.code}`} onClick={() => void toggleDisabled(v)} disabled={busyId === v.id}>
                      {busyId === v.id ? <Loader2 size={14} className="row-spinner"/> : v.disabled ? <Check size={14}/> : <Ban size={14}/>}
                    </button>
                  </span></td>
                </tr>)}
              </tbody>
            </table>)}
      </div>
    </section>}

    {/* ---------- history: every account ---------- */}
    <section className="console-section voucher-history">
      <div className="section-title-row"><div><span className="section-index">{isOperator ? "04" : "02"}</span><div><h2>Redeemed vouchers</h2><p>Vouchers you have already used on this account.</p></div></div></div>
      <div className="voucher-list">
        {historyStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading activity…</strong><p>Reading your redemptions.</p></div>}
        {historyStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load</strong><p>Try refreshing the page.</p></div>}
        {historyStatus === "ready" && (history.length > 0
          ? history.map(r => <div className="voucher-row" key={r.code}>
              <span className="voucher-row-icon"><Check size={16}/></span>
              <div className="voucher-row-copy">
                <strong>{r.label}</strong>
                <small><code>{r.code}</code> · {stamp(r.redeemedAt)}{r.ref ? <> · <code>{r.ref}</code></> : null}</small>
              </div>
              <strong className="voucher-row-credits">+ {trim(r.credits)}</strong>
            </div>)
          : <div className="table-empty"><Tag size={19}/><strong>No vouchers redeemed yet</strong><p>Any voucher you redeem will be listed here.</p></div>)}
      </div>
    </section>
  </div>;
}
