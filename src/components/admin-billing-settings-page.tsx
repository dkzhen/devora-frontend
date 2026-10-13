"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Coins, Loader2, RefreshCw, Save, X } from "lucide-react";
import { formatRupiah, formatUsd, moneyToCredits } from "@/lib/credits";

/**
 * The credit-to-money rate: one number that prices every top-up and values every balance.
 *
 * `idrPerCredit` is the rate an operator sets. `usdPerCredit` is a second READING of the same
 * price, stored because USD is what a foreign buyer asks in — it is not a second price, and the
 * page says so rather than implying two independent knobs.
 */
type BillingSettings = {
  idrPerCredit: string;
  idrPerUsd: string;
  /** Derived server-side from the two stored rates. Read-only here. */
  usdPerCredit: string;
  feeBearer: "buyer" | "merchant";
  updatedAt: string;
  updatedBy: string;
};

/** A quick-jump rupiah figure. The field itself takes any amount; these are the common ones. */
const QUICK_AMOUNTS = [10_000, 25_000, 50_000, 100_000];

/** Trim a stored 8-decimal rate to the shortest exact-looking form for the input box. */
function trimRate(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

export function AdminBillingSettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The form is a draft. Kept separate from `settings` so a save can be verified against what the
  // server returned rather than against what was typed.
  const [idr, setIdr] = useState("");
  const [fx, setFx] = useState("");
  const [feeBearer, setFeeBearer] = useState<"buyer" | "merchant">("buyer");

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/billing-settings", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { settings?: BillingSettings };
      if (!data.settings) { setStatus("error"); return; }
      setSettings(data.settings);
      setIdr(trimRate(data.settings.idrPerCredit));
      setFx(trimRate(data.settings.idrPerUsd));
      setFeeBearer(data.settings.feeBearer);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setNotice(null);
    const idrText = idr.trim();
    const idrNumber = Number(idrText);
    if (idrText === "" || !Number.isFinite(idrNumber) || idrNumber <= 0) {
      setNotice({ kind: "error", text: "Enter how many rupiah one credit is worth." });
      return;
    }

    // Blank means "leave the exchange rate alone" — it is a reading of the same price, and
    // demanding it restated would make the operator invent one.
    const fxText = fx.trim();
    const fxNumber = Number(fxText);
    if (fxText !== "" && (!Number.isFinite(fxNumber) || fxNumber <= 0)) {
      setNotice({ kind: "error", text: "The exchange rate must be a positive number, or blank to keep the current one." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/backend/api/v1/admin/billing-settings", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({
          idrPerCredit: idrText,
          idrPerUsd: fxText === "" ? "" : fxText,
          feeBearer,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not save the rate." });
        return;
      }
      const data = await res.json() as { settings?: BillingSettings };
      if (data.settings) {
        // Re-seed the form from what the database actually stored, not from the input.
        setSettings(data.settings);
        setIdr(trimRate(data.settings.idrPerCredit));
        setFx(trimRate(data.settings.idrPerUsd));
        setFeeBearer(data.settings.feeBearer);
      }
      setNotice({ kind: "ok", text: "Rate saved. New top-ups use it; existing orders keep the rate they were placed at." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setSaving(false); }
  };

  // A live reading of the draft, so the operator sees the rate as money before saving it. This
  // is the same "state the reading under the raw number" rule the token ceiling follows.
  const draftIdr = Number(idr.trim());
  const draftValid = idr.trim() !== "" && Number.isFinite(draftIdr) && draftIdr > 0;
  const draftFx = Number(fx.trim());
  const draftFxValid = fx.trim() !== "" && Number.isFinite(draftFx) && draftFx > 0;

  // Dollars per credit, derived from the two drafts so the operator sees the dollar reading move
  // with the rates instead of typing a third number that could disagree with both.
  const draftUsdPerCredit = draftValid && draftFxValid ? draftIdr / draftFx : 0;

  const dirty = settings !== null && (
    trimRate(settings.idrPerCredit) !== trimRate(idr) ||
    trimRate(settings.idrPerUsd) !== trimRate(fx) ||
    settings.feeBearer !== feeBearer
  );

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Coins size={14}/> ADMIN / BILLING</div>
        <h1>Credit rate</h1>
        <p>What a credit is worth in money. This prices every top-up and values every balance in the console.</p>
      </div>
      <button className="button button-outline compact-button" type="button" onClick={() => void load()} disabled={status === "loading"}>
        <RefreshCw size={15}/> Refresh
      </button>
    </div>

    {status === "loading" && <section className="console-section">
      <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading the rate…</strong></div>
    </section>}

    {status === "error" && <section className="console-section">
      <div className="table-empty"><X size={19}/><strong>Could not load the rate</strong><p>Check that the backend is reachable.</p></div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>The rate</h2><p>One credit is worth this much. Both currencies describe the same price.</p></div></div>
        {settings && <span className="admin-editing-note">
          {settings.updatedAt === ""
            ? "Never set — showing the default."
            : <>Last set {new Date(settings.updatedAt).toLocaleString("id-ID")}{settings.updatedBy ? ` by ${settings.updatedBy}` : ""}.</>}
        </span>}
      </div>

      <div className="admin-form">
        <label className="admin-field">
          <span>Rupiah per credit</span>
          <input value={idr} inputMode="decimal" placeholder="1"
            onChange={e => setIdr(e.target.value)} />
          <small>The rate everything else follows. 1 means 1 credit = Rp 1.</small>
        </label>
        <label className="admin-field">
          <span>Rupiah per dollar</span>
          <input value={fx} inputMode="decimal" placeholder="18000"
            onChange={e => setFx(e.target.value)} />
          <small>The exchange rate. The dollar figure below is derived from it.</small>
        </label>
      </div>

      {/* Raw digits above, the reading below — the operator should not have to count zeroes. */}
      <p className="admin-scale-note" aria-live="polite">
        {draftValid
          ? <><strong>{formatRupiah(draftIdr)}</strong> per credit{draftFxValid
              ? <> · {formatUsd(draftUsdPerCredit)} per credit</> : null}</>
          : <><strong>—</strong> Enter a positive number of rupiah per credit.</>}
      </p>

      <div className="admin-subfield">
        <span className="admin-subfield-label">QRIS gateway fee</span>
        <p className="admin-subfield-hint">Who pays the payment gateway&apos;s cut when someone tops up.</p>
        <div className="kind-tiles">
          <button type="button"
            className={feeBearer === "buyer" ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={feeBearer === "buyer"}
            onClick={() => setFeeBearer("buyer")}>
            <span className="kind-tile-flag">{feeBearer === "buyer" ? "SELECTED" : ""}</span>
            <strong>Buyer pays</strong>
            <small>Charged on top of the credit price. The account receives the full credits it asked for.</small>
          </button>
          <button type="button"
            className={feeBearer === "merchant" ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={feeBearer === "merchant"}
            onClick={() => setFeeBearer("merchant")}>
            <span className="kind-tile-flag">{feeBearer === "merchant" ? "SELECTED" : ""}</span>
            <strong>You absorb it</strong>
            <small>Deducted from what the account pays, so fewer credits land than the amount transferred.</small>
          </button>
        </div>
      </div>

      <div className="admin-actions">
        <button className="button button-ink" type="button" onClick={() => void submit()} disabled={saving || !dirty}>
          {saving ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <>Save rate <Save size={16}/></>}
        </button>
        {!dirty && settings !== null && !notice && <span className="admin-editing-note">No changes to save.</span>}
        {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
          {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
        </p>}
      </div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>What this buys</h2><p>The rate as a customer sees it, before the gateway fee.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr><th>PAY</th><th>CREDITS</th></tr></thead>
          <tbody>
            {QUICK_AMOUNTS.map(amount => {
              const credits = draftValid ? moneyToCredits(amount, String(draftIdr)) : 0;
              return <tr key={amount}>
                <td className="cell-num">{formatRupiah(amount)}</td>
                <td className="cell-num"><strong>{credits.toLocaleString("id-ID", { maximumFractionDigits: 6 })}</strong></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="table-note"><AlertTriangle size={14}/> A rate change reprices future top-ups and how balances read. Orders already placed keep the rate they were created with.</div>
    </section>}

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">03</span><div><h2>Current state</h2><p>What the database holds right now.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <tbody>
            <tr><td><strong>Rupiah per credit</strong></td><td className="cell-num">{settings ? formatRupiah(Number(settings.idrPerCredit)) : "—"}</td></tr>
            <tr><td><strong>Rupiah per dollar</strong></td><td className="cell-num">{settings ? formatRupiah(Number(settings.idrPerUsd)) : "—"}</td></tr>
            <tr><td><strong>Dollar per credit</strong></td><td className="cell-num">{settings ? <>{formatUsd(Number(settings.usdPerCredit))} <small className="cell-sub">derived</small></> : "—"}</td></tr>
            <tr><td><strong>QRIS fee paid by</strong></td><td className="cell-num">{settings?.feeBearer === "merchant" ? "you (absorbed)" : "the buyer"}</td></tr>
            <tr><td><strong>Last changed</strong></td><td className="cell-num">{settings && settings.updatedAt !== ""
              ? new Date(settings.updatedAt).toLocaleString("id-ID")
              : "never"}</td></tr>
          </tbody>
        </table>
      </div>
    </section>}
  </div>;
}
