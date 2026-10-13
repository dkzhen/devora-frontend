"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Layers, Loader2, Package, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { formatTokens } from "@/lib/tokens";

/**
 * A package: a purchasable allowance bundle. `hard_cap` is a token ceiling that ends the
 * allowance; `unlimited` is an open allowance whose *rate* drops past a fair-use threshold.
 */
type PackageCategory = "hard_cap" | "unlimited";

type AdminPackage = {
  id: string;
  name: string;
  description: string;
  category: PackageCategory;
  tier: string;
  durationDays: number | null;
  tokenCap: string | null;
  fairUseCap: string | null;
  baseRpm: number | null;
  throttledRpm: number | null;
  isPublic: boolean;
  sortOrder: number;
  activeSubscriptions: number;
};

const CATEGORIES: { value: PackageCategory; label: string; hint: string }[] = [
  { value: "hard_cap", label: "Hard cap", hint: "A token ceiling. Reaching it ends the package; the account falls back to credits." },
  { value: "unlimited", label: "Unlimited (fair use)", hint: "No ceiling. Past the fair-use threshold the request rate drops, but it keeps serving." },
];

const TIERS = [
  { value: "STANDARD", label: "STANDARD" },
  { value: "SUBSCRIPTION", label: "SUBSCRIPTION" },
  { value: "SUPERUSER", label: "SUPERUSER" },
];

type ModelForm = {
  id: string;
  name: string;
  description: string;
  category: PackageCategory;
  tier: string;
  durationDays: string;
  tokenCap: string;
  fairUseCap: string;
  baseRpm: string;
  throttledRpm: string;
  sortOrder: string;
};

const EMPTY: ModelForm = {
  id: "", name: "", description: "", category: "hard_cap", tier: "SUBSCRIPTION",
  durationDays: "30", tokenCap: "", fairUseCap: "", baseRpm: "", throttledRpm: "20", sortOrder: "0",
};

function slugify(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s_-]/g, "")
    .trim().replace(/\s+/g, "_").replace(/[-_]+/g, "_").slice(0, 63);
}

export function AdminPackagesPage() {
  const { getToken } = useAuth();
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminPackage | null>(null);
  const [form, setForm] = useState<ModelForm>(EMPTY);
  const [editing, setEditing] = useState(false);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/packages", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { packages?: AdminPackage[] };
      setPackages(Array.isArray(data.packages) ? data.packages : []);
      setStatus("ready");
    } catch { setStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const startEdit = (p: AdminPackage) => {
    // Carry EVERY field the form can write. A field the row does not hand over is submitted as
    // the default, so a missing one silently rewrites the package.
    setForm({
      id: p.id, name: p.name, description: p.description, category: p.category, tier: p.tier,
      durationDays: p.durationDays === null ? "" : String(p.durationDays),
      tokenCap: p.tokenCap ?? "", fairUseCap: p.fairUseCap ?? "",
      baseRpm: p.baseRpm === null ? "" : String(p.baseRpm),
      throttledRpm: p.throttledRpm === null ? "" : String(p.throttledRpm),
      sortOrder: String(p.sortOrder),
    });
    setEditing(true);
    setNotice(null);
  };

  const resetForm = () => { setForm(EMPTY); setEditing(false); };

  const submit = async () => {
    setNotice(null);
    const id = form.id.trim();
    const name = form.name.trim();
    if (!name) { setNotice({ kind: "error", text: "Give the package a name." }); return; }
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(id)) {
      setNotice({ kind: "error", text: "Id: 2-63 chars, lowercase letters, digits, underscore, hyphen." });
      return;
    }
    if (form.category === "hard_cap" && !form.tokenCap.trim()) {
      setNotice({ kind: "error", text: "A hard-cap package needs a token ceiling." }); return;
    }
    if (form.category === "unlimited" && !form.fairUseCap.trim()) {
      setNotice({ kind: "error", text: "An unlimited package needs a fair-use threshold." }); return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/backend/api/v1/admin/packages/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({
          name, description: form.description.trim(), category: form.category, tier: form.tier,
          durationDays: form.durationDays.trim(),
          tokenCap: form.category === "hard_cap" ? form.tokenCap.trim() : "",
          fairUseCap: form.category === "unlimited" ? form.fairUseCap.trim() : "",
          baseRpm: form.baseRpm.trim(), throttledRpm: form.throttledRpm.trim(),
          sortOrder: form.sortOrder.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not save the package." });
        return;
      }
      setNotice({ kind: "ok", text: `${name} saved.` });
      resetForm();
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setSaving(false); }
  };

  const remove = async (p: AdminPackage) => {
    setBusyId(p.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/packages/${encodeURIComponent(p.id)}`, {
        method: "DELETE", headers: await authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not delete the package." });
        return;
      }
      setNotice({ kind: "ok", text: `${p.name} deleted.` });
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setBusyId(null); setConfirmDelete(null); }
  };

  const field = (label: string, key: keyof ModelForm, placeholder: string, hint?: string) =>
    <label className="admin-field">
      <span>{label}</span>
      <input value={form[key]} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
      {hint && <small>{hint}</small>}
    </label>;

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Package size={14}/> ADMIN / PACKAGES</div>
        <h1>Packages</h1>
        <p>Allowance bundles a subscription grants: a hard token ceiling, or an unlimited one that throttles past fair use.</p>
      </div>
    </div>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>{editing ? `Edit ${form.id}` : "Create a package"}</h2><p>Id is fixed once a voucher points at it.</p></div></div>
        {editing && <button className="button button-outline compact-button" type="button" onClick={resetForm}><X size={15}/> Cancel edit</button>}
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Category</span>
        <p className="admin-subfield-hint">Decides which allowance field applies, and what happens when it runs out.</p>
        <div className="kind-tiles">
          {CATEGORIES.map(c => <button key={c.value} type="button"
            className={form.category === c.value ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={form.category === c.value}
            onClick={() => setForm(f => ({ ...f, category: c.value }))}>
            <span className="kind-tile-flag">{form.category === c.value ? "SELECTED" : ""}</span>
            <strong>{c.label}</strong><small>{c.hint}</small>
          </button>)}
        </div>
      </div>

      <div className="admin-form">
        <label className="admin-field">
          <span>Name</span>
          <input value={form.name} placeholder="Unlimited Tokens"
            onChange={e => setForm(f => ({
              ...f, name: e.target.value,
              id: editing ? f.id : slugify(e.target.value) + (f.durationDays ? `_${f.durationDays}d` : ""),
            }))} />
          <small>Shown to users.</small>
        </label>
        <label className="admin-field">
          <span>Id</span>
          <input value={form.id} placeholder="unlimited_tokens_30d" disabled={editing}
            onChange={e => setForm(f => ({ ...f, id: slugify(e.target.value) }))} />
          <small>{editing ? "Fixed — vouchers reference it." : "Lowercase, digits, _ / -."}</small>
        </label>
      </div>

      <div className="admin-form">
        {field("Description", "description", "Unlimited requests, fair-use 200M then rate-limited.", "Optional. One line.")}
      </div>

      <div className="admin-form">
        {field("Duration (days)", "durationDays", "30", "Empty = lifetime. Counted from each subscription's start.")}
        <label className="admin-field">
          <span>Tier granted</span>
          <Select label="Tier granted" value={form.tier} onChange={v => setForm(f => ({ ...f, tier: v }))} options={TIERS} />
          <small>Raises the account's model reach while live.</small>
        </label>
      </div>

      <div className="admin-form">
        {form.category === "hard_cap"
          ? field("Token ceiling", "tokenCap", "200000000", "Total tokens this package serves, then it ends.")
          : field("Fair-use threshold", "fairUseCap", "200000000", "Past this, the request rate drops (does not end).")}
        {field("Sort order", "sortOrder", "0", "Lower shows first.")}
      </div>

      <div className="admin-form">
        {field("Base RPM", "baseRpm", "empty = unlimited", "Requests per minute before fair use.")}
        {form.category === "unlimited"
          ? field("Throttled RPM", "throttledRpm", "20", "Requests per minute past fair use.")
          : <label className="admin-field"><span>Throttled RPM</span><input value="" placeholder="n/a for hard cap" disabled /><small>A hard cap ends; it has no throttled leg.</small></label>}
      </div>

      <div className="admin-actions">
        <button className="button button-ink" type="button" onClick={() => void submit()} disabled={saving}>
          {saving ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <>{editing ? "Save package" : "Create package"} <Save size={16}/></>}
        </button>
        {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
          {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
        </p>}
      </div>
    </section>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>All packages</h2><p>What subscriptions can grant.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void load()}><RefreshCw size={15}/> Refresh</button>
      </div>

      <div className="model-table-wrap">
        {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading packages…</strong></div>}
        {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load packages</strong></div>}
        {status === "ready" && packages.length === 0 && <div className="table-empty">
          <Layers size={19}/><strong>No packages yet</strong><p>Create the first one above.</p>
        </div>}
        {status === "ready" && packages.length > 0 && <table className="model-table table-events">
          <thead><tr>
            <th>PACKAGE</th><th>CATEGORY</th><th>TIER</th><th>ALLOWANCE</th><th>RPM</th><th>DURATION</th><th>LIVE</th><th></th>
          </tr></thead>
          <tbody>{packages.map(p => <tr key={p.id}>
            <td>
              <strong>{p.name}</strong>
              <small className="cell-sub"><code>{p.id}</code></small>
            </td>
            <td><span className="kind-tag">{CATEGORIES.find(c => c.value === p.category)?.label ?? p.category}</span></td>
            <td><span className="plan-tag">{p.tier}</span></td>
            <td className="cell-num">
              {p.category === "hard_cap"
                ? <>cap {formatTokens(Number(p.tokenCap ?? 0))}</>
                : <>fair {formatTokens(Number(p.fairUseCap ?? 0))}</>}
            </td>
            <td className="cell-num">
              {p.baseRpm === null ? "unlim" : p.baseRpm}
              {p.category === "unlimited" && p.throttledRpm !== null && <> → {p.throttledRpm}</>}
            </td>
            <td className="cell-num">{p.durationDays === null ? "lifetime" : `${p.durationDays}d`}</td>
            <td className="cell-num">{p.activeSubscriptions}</td>
            <td>
              <span className="row-actions">
                <button className="row-action" type="button" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => startEdit(p)} disabled={busyId === p.id}><Save size={14}/></button>
                <button className="row-action row-action-danger" type="button" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => setConfirmDelete(p)} disabled={busyId === p.id}>
                  {busyId === p.id ? <Loader2 size={14} className="row-spinner"/> : <Trash2 size={14}/>}
                </button>
              </span>
            </td>
          </tr>)}</tbody>
        </table>}
      </div>
      <div className="table-note"><AlertTriangle size={14}/> Deleting a package a voucher references is refused — retarget the voucher first.</div>
    </section>

    <Modal open={confirmDelete !== null} tone="danger" title="Delete this package?"
      subtitle={confirmDelete ? confirmDelete.id : ""} onClose={() => setConfirmDelete(null)}
      footer={<>
        <button className="button button-outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => confirmDelete && void remove(confirmDelete)} disabled={busyId !== null}>
          {busyId !== null ? <Loader2 size={15} className="row-spinner"/> : <Trash2 size={15}/>} Delete
        </button>
      </>}>
      {confirmDelete && <div className="events-dialog">
        <p><AlertTriangle size={15}/> <span><strong>{confirmDelete.name}</strong> will stop being grantable. {confirmDelete.activeSubscriptions > 0
          ? <>It has <strong>{confirmDelete.activeSubscriptions}</strong> live subscription(s) — those keep their allowance and window.</>
          : "No account holds it right now."}</span></p>
        <div className="modal-danger-note">
          <strong>Cannot be undone</strong>
          <span>Existing subscriptions are unaffected; only future grants stop. A voucher pointing here will refuse the delete.</span>
        </div>
      </div>}
    </Modal>
  </div>;
}
