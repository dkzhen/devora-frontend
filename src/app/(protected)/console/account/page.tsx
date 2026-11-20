"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { AlertTriangle, Coins, Loader2, Package, RefreshCw, UserCircle, Zap } from "lucide-react";
import { formatCounter } from "@/lib/format-counter";
import { formatCredits } from "@/lib/credits";

type Subscription = {
  id: string;
  packageId: string;
  name: string;
  category: "hard_cap" | "unlimited";
  tier: string;
  startedAt: string;
  expiresAt: string | null;
  tokensUsed: string;
  tokenCap: string | null;
  fairUseCap: string | null;
  exhausted: boolean;
};

type MeResponse = {
  user?: {
    plan?: string;
    credits?: string;
    freeTokensUsed?: number;
    status?: string;
  };
  subscriptions?: Subscription[];
};

const stamp = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

export default function AccountPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [data, setData] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshKey, setRefreshKey] = useState(0);

  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.primaryEmailAddress?.emailAddress || "Account" : "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "—";
  const initials = user ? [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || name.slice(0, 2).toUpperCase() : "A";

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/users/me", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setStatus("error"); return; }
      setData(await res.json() as MeResponse);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [getToken]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const plan = data?.user?.plan ?? "STANDARD";
  const credits = data?.user?.credits ?? "0";
  const freeTokensUsed = data?.user?.freeTokensUsed ?? 0;
  const subs = data?.subscriptions ?? [];
  const FREE_LIMIT = 20_000_000;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow small-eyebrow"><UserCircle size={14}/> ACCOUNT</div>
          <h1>My Account</h1>
          <p>Your profile, plan, and active subscriptions.</p>
        </div>
        <button className="button button-outline compact-button" onClick={() => setRefreshKey(k => k + 1)} disabled={status === "loading"}>
          <RefreshCw size={14}/> Refresh
        </button>
      </div>

      {status === "error" && <div className="usage-loading-centered"><AlertTriangle size={24}/> <span>Could not load account data.</span></div>}

      {(status === "loading" || status === "ready") && (
        <>
          {/* Section 00: Profile */}
          <section className="console-section">
            <div className="section-title-row">
              <div>
                <span className="section-index">00</span>
                <div><h2>Profile</h2><p>Your identity and account status.</p></div>
              </div>
            </div>

            {status === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading profile…</span></div>}

            {status === "ready" && (
              <div className="model-table-wrap" style={{ marginTop: 8 }}>
                <table className="model-table">
                  <tbody>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}><strong>Name</strong></td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <span className="account-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>{initials}</span>
                          {name}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}><strong>Email</strong></td>
                      <td>{email}</td>
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}><strong>Plan</strong></td>
                      <td><span className={`plan-tag plan-${plan.toLowerCase()}`}>{plan}</span></td>
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}><strong>Status</strong></td>
                      <td><span className={`status-pill status-${data?.user?.status === "ACTIVE" ? "active" : "pending"}`}>{data?.user?.status ?? "ACTIVE"}</span></td>
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: "nowrap" }}><strong>Credits</strong></td>
                      <td className="cell-num">{formatCredits(Number(credits))}</td>
                    </tr>
                    {plan !== "SUPERUSER" && plan !== "SUBSCRIPTION" && (
                      <tr>
                        <td style={{ whiteSpace: "nowrap" }}><strong>Free tokens</strong></td>
                        <td className="cell-num">{formatCounter(freeTokensUsed)} / {formatCounter(FREE_LIMIT)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 01: Active subscriptions */}
          <section className="console-section">
            <div className="section-title-row">
              <div>
                <span className="section-index">01</span>
                <div><h2>Subscriptions</h2><p>Your active package subscriptions.</p></div>
              </div>
            </div>

            {status === "loading" && <div className="usage-loading-centered"><Loader2 size={24} className="spin"/> <span>Loading subscriptions…</span></div>}

            {status === "ready" && (
              subs.length === 0
                ? <div className="table-empty"><Package size={22}/><strong>No active subscriptions</strong><p>You don&apos;t have any live package subscriptions.</p></div>
                : <div className="model-table-wrap" style={{ marginTop: 8 }}>
                    <table className="model-table">
                      <thead><tr>
                        <th style={{ whiteSpace: "nowrap" }}>PACKAGE</th>
                        <th style={{ whiteSpace: "nowrap" }}>CATEGORY</th>
                        <th style={{ whiteSpace: "nowrap" }}>TOKENS USED</th>
                        <th style={{ whiteSpace: "nowrap" }}>EXPIRES</th>
                        <th style={{ whiteSpace: "nowrap" }}>STATUS</th>
                      </tr></thead>
                      <tbody>
                        {subs.map(s => {
                          const unlimited = s.category === "unlimited";
                          const cap = unlimited ? s.fairUseCap : s.tokenCap;
                          const used = Number(s.tokensUsed);
                          const capNum = cap ? Number(cap) : null;
                          return (
                            <tr key={s.id}>
                              <td><strong>{s.name}</strong><br/><code style={{ fontSize: "var(--fs-micro)", color: "var(--muted)" }}>{s.packageId}</code></td>
                              <td><span className="status-pill" style={{ fontSize: "0.7rem" }}>{unlimited ? "Fair use" : "Hardcap"}</span></td>
                              <td className="cell-num">
                                {formatCounter(used)}
                                {capNum !== null && <span className="cell-sub">/ {formatCounter(capNum)}</span>}
                              </td>
                              <td className="cell-num">{s.expiresAt ? stamp(s.expiresAt) : "Lifetime"}</td>
                              <td>
                                {s.exhausted
                                  ? <span className="status-pill status-canceled" style={{ color: "#c62828" }}>Exhausted</span>
                                  : <span className="status-pill status-active">Active</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
