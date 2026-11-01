"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, CreditCard, Loader2, RefreshCw, Save, X } from "lucide-react";

type PaymentMethod = {
  id: string;
  name: string;
  gateway: string;
  category: "credits" | "idr" | "usd";
  currency: string;
  visibility: "active" | "inactive" | "private";
  available: boolean;
  gatewayReady: boolean;
  mode?: string;
  sortOrder: number;
  icon: string | null;
  description: string | null;
};

type ExchangeRates = {
  idrToCredits: string;
  usdToCredits: string;
};

export function PaymentSettings() {
  const { getToken } = useAuth();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [methodsStatus, setMethodsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [ratesStatus, setRatesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [idrRate, setIdrRate] = useState("");
  const [usdRate, setUsdRate] = useState("");
  const [savingRates, setSavingRates] = useState(false);
  const [rateNotice, setRateNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

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

  useEffect(() => { void loadMethods(); void loadRates(); }, [loadMethods, loadRates]);

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

  const catLabel = (cat: string) => cat === "credits" ? "Credits" : cat === "idr" ? "IDR" : "USD";

  return <>
    {/* Exchange rates */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">06</span><div><h2>Exchange rates</h2><p>Credits per unit of currency. Used to convert IDR/USD prices to credits.</p></div></div>
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

    {/* Payment methods */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">07</span><div><h2>Payment methods</h2><p>Enable, disable, or set payment gateways to private. Active methods appear in the checkout popup. Private methods only appear for superusers.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void loadMethods()} disabled={methodsStatus === "loading"}>
          <RefreshCw size={14}/> Refresh
        </button>
      </div>
      {methodsStatus === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading payment methods…</span></div>}
      {methodsStatus === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load payment methods.</span></div>}
      {methodsStatus === "ready" && methods && methods.length > 0 && (
        <div className="model-table-wrap">
          <table className="model-table">
            <thead><tr>
              <th style={{whiteSpace:"nowrap"}}>Name</th>
              <th style={{whiteSpace:"nowrap"}}>Gateway</th>
              <th style={{whiteSpace:"nowrap"}}>Category</th>
              <th style={{whiteSpace:"nowrap"}}>Currency</th>
              <th style={{whiteSpace:"nowrap"}}>Gateway</th>
              <th style={{whiteSpace:"nowrap"}}>Mode</th>
              <th style={{whiteSpace:"nowrap"}}>Payment</th>
              <th style={{whiteSpace:"nowrap"}}>Action</th>
            </tr></thead>
            <tbody>
              {methods.map(m => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong>{m.description && <span className="cell-sub">{m.description}</span>}</td>
                  <td><code>{m.gateway}</code></td>
                  <td><span className={`outcome-pill outcome-${m.category === "credits" ? "ok" : m.category === "idr" ? "interrupted" : "error"}`}>{catLabel(m.category)}</span></td>
                  <td className="cell-num">{m.currency}</td>
                  <td>
                    {m.gatewayReady
                      ? <span className="status-pill status-completed">Ready</span>
                      : <span className="status-pill status-canceled">Not ready</span>}
                  </td>
                  <td className="cell-num">{m.mode ?? "—"}</td>
                  <td>
                    {m.visibility === "active"
                      ? <span className="status-pill status-completed">Active</span>
                      : m.visibility === "private"
                      ? <span className="status-pill" style={{background:"#fef3c7",color:"#92400e",border:"1px solid #fcd34d"}}>Private</span>
                      : <span className="status-pill status-canceled">Inactive</span>}
                  </td>
                  <td>
                    <div style={{display:"flex",gap:"4px"}}>
                      {/* Enable / Disable */}
                      {(m.visibility === "active" || m.visibility === "private") && (
                        <button
                          className="button button-outline compact-button"
                          type="button"
                          onClick={() => void setVisibility(m.id, "inactive")}
                          disabled={togglingId === m.id}
                        >
                          {togglingId === m.id ? <><Loader2 size={14} className="row-spinner"/> …</> : "Disable"}
                        </button>
                      )}
                      {m.visibility === "inactive" && (
                        <button
                          className="button compact-button"
                          type="button"
                          onClick={() => void setVisibility(m.id, "active")}
                          disabled={togglingId === m.id || !m.gatewayReady}
                          title={!m.gatewayReady ? "Gateway is not ready" : undefined}
                        >
                          {togglingId === m.id ? <><Loader2 size={14} className="row-spinner"/> …</> : "Enable"}
                        </button>
                      )}
                      {/* Private / Public toggle — always shown when gateway is ready */}
                      {m.gatewayReady && (
                        m.visibility === "private"
                          ? <button
                              className="button compact-button"
                              type="button"
                              style={{borderColor:"#f59e0b",color:"#b45309"}}
                              onClick={() => void setVisibility(m.id, "active")}
                              disabled={togglingId === m.id}
                            >
                              Public
                            </button>
                          : m.visibility !== "inactive" && (
                            <button
                              className="button button-outline compact-button"
                              type="button"
                              style={{borderColor:"#f59e0b",color:"#b45309"}}
                              onClick={() => void setVisibility(m.id, "private")}
                              disabled={togglingId === m.id}
                              title="Visible to superusers only"
                            >
                              Private
                            </button>
                          )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </>;
}
