"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Coins, Lock, LockOpen, Loader2, RefreshCw, Save, X } from "lucide-react";
import { formatRupiah, moneyToCredits } from "@/lib/credits";
import { Modal } from "@/components/modal";

/**
 * The credit-to-rupiah rate: the one number that prices every top-up and values every balance.
 *
 * Rupiah only. A dollar figure was tried twice — first as its own column, then derived from an
 * exchange rate — and removed both times: it was a second number to keep in step with this one,
 * and QRIS settles in rupiah, so it had no consumer.
 */
type BillingSettings = {
  idrPerCredit: string;
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

type PaymentMethod = {
  id: string;
  name: string;
  gateway: string;
  category: "credits" | "idr" | "usd";
  currency: string;
  isActive: boolean;
  visibility: "active" | "inactive" | "private";
  gatewayReady: boolean;
  mode: string;
  sortOrder: number;
  icon: string | null;
  description: string | null;
};

type ExchangeRates = {
  idrToCredits: string;
  usdToCredits: string;
};

export function AdminPaymentPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The form is a draft. Kept separate from `settings` so a save can be verified against what the
  // server returned rather than against what was typed.
  const [idr, setIdr] = useState("");
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

    setSaving(true);
    try {
      const res = await fetch("/backend/api/v1/admin/billing-settings", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ idrPerCredit: idrText, feeBearer }),
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

  const dirty = settings !== null && (
    trimRate(settings.idrPerCredit) !== trimRate(idr) ||
    settings.feeBearer !== feeBearer
  );

  // ---------------------------------------------------------------------------
  // Section 00: Payment gateways — fetch methods, group by category, clickable → popup.
  // ---------------------------------------------------------------------------
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [methodsStatus, setMethodsStatus] = useState<"loading" | "ready" | "error">("loading");

  // Gateway detail modal.
  const [gatewayModal, setGatewayModal] = useState<PaymentMethod | null>(null);

  const loadMethods = useCallback(async () => {
    setMethodsStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/payment/methods", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setMethodsStatus("error"); return; }
      const data = await res.json() as { methods?: PaymentMethod[] };
      setMethods(data.methods ?? []);
      setMethodsStatus("ready");
    } catch { setMethodsStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void loadMethods(); }, [loadMethods]);

  // ---------------------------------------------------------------------------
  // Section 01: Exchange rates (inlined from PaymentSettings).
  // ---------------------------------------------------------------------------
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [ratesStatus, setRatesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [idrRate, setIdrRate] = useState("");
  const [usdRate, setUsdRate] = useState("");
  const [savingRates, setSavingRates] = useState(false);
  const [rateNotice, setRateNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const loadRates = useCallback(async () => {
    setRatesStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/payment/rates", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setRatesStatus("error"); return; }
      const data = await res.json() as { rates?: ExchangeRates };
      setRates(data.rates ?? null);
      setIdrRate(data.rates?.idrToCredits ?? "");
      setUsdRate(data.rates?.usdToCredits ?? "");
      setRatesStatus("ready");
    } catch { setRatesStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void loadRates(); }, [loadRates]);

  const saveRates = async () => {
    setSavingRates(true);
    setRateNotice(null);
    try {
      const res = await fetch("/backend/api/v1/admin/payment/rates", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ idrToCredits: idrRate, usdToCredits: usdRate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setRateNotice({ kind: "error", text: body?.error?.message ?? "Could not save rates." });
        return;
      }
      const data = await res.json() as { rates?: ExchangeRates };
      if (data.rates) { setRates(data.rates); setIdrRate(data.rates.idrToCredits); setUsdRate(data.rates.usdToCredits); }
      setRateNotice({ kind: "ok", text: "Exchange rates updated." });
    } catch {
      setRateNotice({ kind: "error", text: "Could not reach the server." });
    } finally { setSavingRates(false); }
  };

  // ---------------------------------------------------------------------------
  // Section 02: Payment methods toggle (inlined from PaymentSettings).
  // ---------------------------------------------------------------------------
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const setVisibility = async (id: string, visibility: "active" | "inactive" | "private") => {
    setTogglingId(id);
    try {
      const res = await fetch(`/backend/api/v1/admin/payment/methods/${id}`, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ visibility }),
      });
      if (res.ok) { void loadMethods(); }
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  };

  const catLabel = (cat: string) => cat === "credits" ? "Credits" : cat === "idr" ? "IDR" : "USD";

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Coins size={14}/> ADMIN / PAYMENT</div>
        <h1>Payment settings</h1>
        <p>Payment gateways, exchange rates, and billing configuration.</p>
      </div>
    </div>

    {/* Section 00: Payment gateways — clickable list grouped by category. */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">00</span><div><h2>Payment gateways</h2><p>Status and health of each payment gateway.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => { void loadMethods(); }} disabled={methodsStatus === "loading"}>
          <RefreshCw size={15}/> Refresh
        </button>
      </div>

      {methodsStatus === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading gateways…</span></div>}
      {methodsStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load payment gateways.</span></div>}

      {methodsStatus === "ready" && methods && (() => {
        const idrMethods = methods.filter(m => m.category === "idr");
        const usdMethods = methods.filter(m => m.category === "usd");
        const creditsMethods = methods.filter(m => m.category === "credits");

        const renderGatewayRow = (m: PaymentMethod) => {
          const isReady = m.gatewayReady;
          const vis = m.visibility;
          const toggling = togglingId === m.id;
          const borderColour = vis === "active" ? "#17756b" : vis === "private" ? "#f59e0b" : "#c44";
          return (
            <div
              key={m.id}
              className="gateway-row"
              style={{
                padding: "12px 16px",
                border: `1.5px solid ${borderColour}`,
                borderRadius: 8, marginBottom: 8, cursor: "pointer", transition: "border-color 0.15s",
              }}
              onClick={() => setGatewayModal(m)}
            >
              {/* Row 1: title */}
              <strong>{m.name}</strong>
              {/* Row 2: gateway id */}
              <div><em style={{ fontSize: "0.75em", opacity: 0.5, fontStyle: "italic" }}>{m.gateway}</em></div>
              {/* Row 3: description */}
              {m.description && <div><small style={{ opacity: 0.6, fontSize: "0.8em" }}>{m.description}</small></div>}
              {/* Row 4: badge (left) + buttons (right) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }} onClick={e => e.stopPropagation()}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  padding: "2px 10px", borderRadius: "3px", fontSize: "var(--fs-micro)", fontWeight: "700",
                  letterSpacing: ".5px", color: "#fff",
                  background: isReady ? "#17756b" : "#c44", whiteSpace: "nowrap",
                }}>
                  {isReady ? "Ready" : "Not ready"}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  {(vis === "active" || vis === "private") && (
                    <button
                      className="button button-outline compact-button"
                      type="button"
                      onClick={() => void setVisibility(m.id, "inactive")}
                      disabled={toggling}
                    >
                      {toggling ? <><Loader2 size={14} className="row-spinner"/> …</> : "Disable"}
                    </button>
                  )}
                  {vis === "inactive" && (
                    <button
                      className="button button-ink compact-button"
                      type="button"
                      title={!m.gatewayReady ? "Gateway not ready" : undefined}
                      onClick={() => void setVisibility(m.id, "active")}
                      disabled={toggling || !m.gatewayReady}
                    >
                      {toggling ? <><Loader2 size={14} className="row-spinner"/> …</> : "Enable"}
                    </button>
                  )}
                  {m.gatewayReady && (
                    vis === "private"
                      ? <button
                          className="button compact-button"
                          type="button"
                          style={{borderColor:"#f59e0b",color:"#b45309"}}
                          onClick={() => void setVisibility(m.id, "active")}
                          disabled={toggling}
                        >
                          <LockOpen size={14}/>
                        </button>
                      : vis !== "inactive" && (
                        <button
                          className="button button-outline compact-button"
                          type="button"
                          style={{borderColor:"#f59e0b",color:"#b45309"}}
                          onClick={() => void setVisibility(m.id, "private")}
                          disabled={toggling}
                          title="Visible to superusers only"
                        >
                          <Lock size={14}/>
                        </button>
                      )
                  )}
                </div>
              </div>
            </div>
          );
        };

        return (
          <div>
            {idrMethods.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "var(--fs-note)", fontWeight: 700, opacity: 0.6, marginTop: 25, marginBottom: 12 }}>IDR (Indonesian Rupiah)</div>
                {idrMethods.map(renderGatewayRow)}
              </div>
            )}
            {idrMethods.length === 0 && (
              <div style={{ padding: "24px 16px", textAlign: "center", border: "1.5px dashed #d8d1c5", borderRadius: 8, marginBottom: 16 }}>
                <p style={{ opacity: 0.6, margin: 0 }}>No IDR payment method configured.</p>
              </div>
            )}
            {usdMethods.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "var(--fs-note)", fontWeight: 700, opacity: 0.6, marginTop: 25, marginBottom: 12 }}>USD (Global)</div>
                {usdMethods.map(renderGatewayRow)}
              </div>
            )}
            {usdMethods.length === 0 && (
              <div style={{ padding: "24px 16px", textAlign: "center", border: "1.5px dashed #d8d1c5", borderRadius: 8 }}>
                <p style={{ opacity: 0.6, margin: 0 }}>No Global payment method configured.</p>
              </div>
            )}
            {creditsMethods.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "var(--fs-note)", fontWeight: 700, opacity: 0.6, marginTop: 25, marginBottom: 12 }}>Credits</div>
                {creditsMethods.map(renderGatewayRow)}
              </div>
            )}
            {creditsMethods.length === 0 && (
              <div style={{ padding: "24px 16px", textAlign: "center", border: "1.5px dashed #d8d1c5", borderRadius: 8 }}>
                <p style={{ opacity: 0.6, margin: 0 }}>No Credits payment method configured.</p>
              </div>
            )}
          </div>
        );
      })()}
    </section>

    {/* Section 01: Exchange rates (inlined). */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Exchange rates</h2><p>Credits per unit of currency.</p></div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 5 }}>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadRates()} disabled={ratesStatus === "loading"}>
          <RefreshCw size={14}/> Refresh
        </button>
      </div>
      {ratesStatus === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading rates…</span></div>}
      {ratesStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load rates.</span></div>}
      {ratesStatus === "ready" && (
        <div className="admin-form">
          <label className="admin-field">
            <span>IDR → Credits</span>
            <input value={idrRate} inputMode="decimal" placeholder="0.1" onChange={e => setIdrRate(e.target.value)} />
            <small>Credits per 1 IDR. E.g. 0.1 means Rp 10,000 = 1,000 credits.</small>
          </label>
          <label className="admin-field">
            <span>USD → Credits</span>
            <input value={usdRate} inputMode="decimal" placeholder="1500" onChange={e => setUsdRate(e.target.value)} />
            <small>Credits per 1 USD. E.g. 1500 means $1 = 1,500 credits.</small>
          </label>
        </div>
      )}
      {ratesStatus === "ready" && (
        <div className="admin-actions">
          <button className="button button-ink" type="button" onClick={() => void saveRates()} disabled={savingRates}>
            {savingRates ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <><Save size={16}/> Save rates</>}
          </button>
          {rateNotice && <p className={rateNotice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
            {rateNotice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{rateNotice.text}
          </p>}
        </div>
      )}
    </section>

    {status === "ready" && <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>The rate</h2><p>One credit is worth this much.</p></div></div>
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
      </div>

      {/* Raw digits above, the reading below — the operator should not have to count zeroes. */}
      <p className="admin-scale-note" aria-live="polite">
        {draftValid
          ? <><strong>{formatRupiah(draftIdr)}</strong> per credit</>
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
        <div><span className="section-index">04</span><div><h2>What this buys</h2><p>The rate as a customer sees it, before the gateway fee.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <thead><tr><th style={{ whiteSpace: "nowrap" }}>PAY</th><th style={{ whiteSpace: "nowrap" }}>CREDITS</th></tr></thead>
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
        <div><span className="section-index">05</span><div><h2>Current state</h2><p>What the database holds right now.</p></div></div>
      </div>
      <div className="model-table-wrap">
        <table className="model-table">
          <tbody>
            <tr><td><strong>Rupiah per credit</strong></td><td className="cell-num">{settings ? formatRupiah(Number(settings.idrPerCredit)) : "—"}</td></tr>
            <tr><td><strong>QRIS fee paid by</strong></td><td className="cell-num">{settings?.feeBearer === "merchant" ? "you (absorbed)" : "the buyer"}</td></tr>
            <tr><td><strong>Last changed</strong></td><td className="cell-num">{settings && settings.updatedAt !== ""
              ? new Date(settings.updatedAt).toLocaleString("id-ID")
              : "never"}</td></tr>
          </tbody>
        </table>
      </div>
    </section>}

    {/* Gateway detail modal: shows health info for the selected gateway. */}
    <Modal
      open={gatewayModal !== null}
      title={gatewayModal?.name ?? "Gateway"}
      subtitle={gatewayModal ? `${gatewayModal.gateway} — ${catLabel(gatewayModal.category)} / ${gatewayModal.currency}` : ""}
      onClose={() => setGatewayModal(null)}
      footer={<button className="button button-outline compact-button" type="button" onClick={() => setGatewayModal(null)}>Close</button>}
    >
      {gatewayModal && (() => {
        return (
          <div className="model-table-wrap">
            <table className="model-table">
              <tbody>
                <tr><td><strong>Name</strong></td><td>{gatewayModal.name}</td></tr>
                <tr><td><strong>Gateway</strong></td><td><code>{gatewayModal.gateway}</code></td></tr>
                <tr><td><strong>Category</strong></td><td>{catLabel(gatewayModal.category)}</td></tr>
                <tr><td><strong>Currency</strong></td><td className="cell-num">{gatewayModal.currency}</td></tr>
                {gatewayModal.description && <tr><td><strong>Description</strong></td><td>{gatewayModal.description}</td></tr>}
                <tr><td><strong>Mode</strong></td><td>{gatewayModal.mode === "Sandbox" ? <span className="status-pill status-canceled">Sandbox</span> : gatewayModal.mode === "Production" ? <span className="status-pill status-completed">Production</span> : gatewayModal.mode}</td></tr>
                <tr><td><strong>Gateway ready</strong></td><td>{gatewayModal.gatewayReady ? <span className="status-pill status-completed">Yes</span> : <span className="status-pill status-canceled">No</span>}</td></tr>
                <tr><td><strong>Active</strong></td><td>{gatewayModal.isActive ? <span className="status-pill status-completed">Yes</span> : <span className="status-pill status-canceled">No</span>}</td></tr>
              </tbody>
            </table>
          </div>
        );
      })()}
    </Modal>
  </div>;
}
