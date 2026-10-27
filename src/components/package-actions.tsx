"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, ArrowUpRight, Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";

/**
 * The two self-service moves on a live package, each behind a dialog that states its consequences
 * before the write.
 *
 * Both exist because the alternative was a dead end. A hard cap that runs out while its window is
 * still open cannot be re-bought — the live subscription holds the unique slot — so without a
 * top-up the customer simply has no way to buy more of what they are already paying for. And a
 * package that raised the account's plan does not lower it on removal by itself, because
 * `effectiveTier` treats the stored plan as a floor, so an unexplained "your plan just changed"
 * would be the only feedback they got.
 *
 * The dialogs are reading material, deliberately. The numbers come from the server
 * (`/subscriptions/reclaim-preview`) rather than being inferred here, so what the customer agrees
 * to is what the write actually does.
 */

type Sub = { id: string; packageId: string; name: string; category: string; tier: string; exhausted: boolean };

type Preview = {
  packages: number;
  raisedPlan: boolean;
  currentPlan: string;
  revertsTo: string;
  modelsLosingAccess: number;
};

export function PackageActions({ sub, onChanged }: { sub: Sub; onChanged: () => void }) {
  const { getToken } = useAuth();
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  };

  const openRemove = async () => {
    setError("");
    setRemoving(true);
    // Fetched on open, not on render: the answer depends on state that changes, and a stale
    // warning is worse than a slow one.
    try {
      const res = await fetch("/backend/api/v1/subscriptions/reclaim-preview", { headers: await authHeaders(), cache: "no-store" });
      setPreview(res.ok ? await res.json() as Preview : null);
    } catch { setPreview(null); }
  };

  const confirmRemove = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/backend/api/v1/subscriptions/${sub.id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not remove the package."); return;
      }
      setRemoving(false);
      onChanged();
    } catch { setError("Could not reach the gateway."); }
    finally { setBusy(false); }
  };

  const confirmReset = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/backend/api/v1/subscriptions/${sub.id}/reset?acknowledge=1`, { method: "POST", headers: await authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not top up the allowance."); return;
      }
      onChanged();
    } catch { setError("Could not reach the gateway."); }
    finally { setBusy(false); }
  };

  const isHardCap = sub.category === "hard_cap";

  return <>
    <div className="sub-actions">
      <button className="button button-outline compact-button sub-remove" type="button" onClick={() => void openRemove()}>
        <Trash2 size={14}/> Remove
      </button>
    </div>

    {/* ---------- remove ---------- */}
    <Modal
      open={removing}
      title="Remove this package?"
      subtitle={<>{sub.name}</>}
      tone="danger"
      onClose={() => setRemoving(false)}
      busy={busy}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setRemoving(false)} disabled={busy}>Keep it</button>
        <button className="button button-ink compact-button" type="button" onClick={() => void confirmRemove()} disabled={busy}>
          {busy ? <><Loader2 size={14} className="spin"/> Removing…</> : "Remove package"}
        </button>
      </>}
    >
      <p className="confirm-lead"><AlertTriangle size={14}/> This takes effect immediately and cannot be undone.</p>
      <ul className="confirm-list">
        <li><strong>Free traffic stops now.</strong> The allowance is gone, including anything left in it. Requests fall back to your credits and are billed per token.</li>
        {preview?.raisedPlan
          ? <li><strong>Your plan drops to {preview.revertsTo}.</strong> It is currently {preview.currentPlan} because this package raised it.
            {preview.modelsLosingAccess > 0 && <> <strong>{preview.modelsLosingAccess} model{preview.modelsLosingAccess === 1 ? "" : "s"} become unreachable</strong> at that tier — calls to them answer <code>403 plan_required</code>.</>}
            {" "}Credits already bought are unaffected.</li>
          : <li><strong>Your plan is already {preview?.revertsTo ?? "STANDARD"}.</strong> This package did not raise it, so nothing changes there. Credits already bought are unaffected.</li>}
        <li><strong>The slot is freed.</strong> You can buy this same package again straight away — which right now you cannot, while it is active.</li>
        <li><strong>The record is kept.</strong> The package stays in your history as <em>removed</em>, and its usage figures stay readable. Nothing is deleted.</li>
        {/* Stated plainly because it is the surprising one: an exhausted package removed and
            re-bought does NOT start with the full allowance — the counter carries over. */}
        {sub.exhausted && <li><strong>Re-buying will not reset your usage.</strong> This package is already spent, and that count is kept. Remove it, and a fresh purchase of the same package still starts from the tokens you have used.</li>}
      </ul>
      <p className="confirm-note">To keep the package and get more tokens instead, use <strong>Top up allowance</strong>.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  </>;
}
