"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Layers, Loader2, Package, Plus, RefreshCw, Save, Search, Trash2, Users, X } from "lucide-react";
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
  activeSubscriptions: number;
  /** The models this package's free allowance covers. */
  modelIds: string[];
};

type ModelOption = { id: string; name: string; provider: string; accessPlans: string[] };

/** One live subscription, joined to the account that holds it. */
type Subscriber = {
  userId: string;
  email: string;
  name: string;
  packageId: string;
  packageName: string;
  tier: string;
  startedAt: string;
  expiresAt: string | null;
  tokenCap: string | null;
  tokensUsed: string;
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
};

const EMPTY: ModelForm = {
  id: "", name: "", description: "", category: "hard_cap", tier: "SUBSCRIPTION",
  durationDays: "30", tokenCap: "", fairUseCap: "", baseRpm: "", throttledRpm: "20",
};

/** A pricing plan: a marketing card linked to a package. */
type PricingPlan = {
  id: string;
  displayName: string;
  displayDescription: string;
  features: string[];
  priceIdr: number;
  priceCredits: string;
  packageId: string;
  packageName: string;
  sortOrder: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Form state for creating/editing a pricing plan. */
type PlanForm = {
  displayName: string;
  displayDescription: string;
  features: string[];
  priceIdr: string;
  priceCredits: string;
  paymentType: "idr" | "credits" | "both";
  packageId: string;
  sortOrder: string;
  isPublic: boolean;
};

const EMPTY_PLAN: PlanForm = {
  displayName: "", displayDescription: "", features: [],
  priceIdr: "0", priceCredits: "0", paymentType: "idr", packageId: "", sortOrder: "0", isPublic: true,
};

function slugifyPlan(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

function slugify(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s_-]/g, "")
    .trim().replace(/\s+/g, "_").replace(/[-_]+/g, "_").slice(0, 63);
}

export function AdminPackagesPage() {
  const { getToken } = useAuth();
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Subscribers load on their own request: a failure there must not blank the package table,
  // and the two are read from different joins.
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subsStatus, setSubsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminPackage | null>(null);
  const [form, setForm] = useState<ModelForm>(EMPTY);
  const [editing, setEditing] = useState(false);
  /** Model ids the draft package covers. Required — a package with no models covers nothing. */
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelFilter, setModelFilter] = useState("");

  // ---- pricing plans state ----
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
  const [plansStatus, setPlansStatus] = useState<"loading" | "ready" | "error">("loading");
  const [planForm, setPlanForm] = useState<PlanForm>(EMPTY_PLAN);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planNotice, setPlanNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState<PricingPlan | null>(null);
  const [planFeatureInput, setPlanFeatureInput] = useState("");

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

  /**
   * Who holds a package right now.
   *
   * Its own request rather than a field on the package list: one account may hold two packages,
   * so this is keyed by subscription, not by package, and a broken read here should not blank
   * the table above it.
   */
  const loadSubscribers = useCallback(async () => {
    setSubsStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/packages/subscribers", {
        headers: await authHeaders(), cache: "no-store",
      });
      if (!res.ok) { setSubsStatus("error"); return; }
      const data = await res.json() as { subscribers?: Subscriber[] };
      setSubscribers(Array.isArray(data.subscribers) ? data.subscribers : []);
      setSubsStatus("ready");
    } catch { setSubsStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void loadSubscribers(); }, [loadSubscribers]);

  // The model catalogue powers the coverage picker. Fetched once; the console's own admin
  // route already returns what the picker needs (id, name, provider).
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/backend/api/v1/admin/models", { headers: await authHeaders(), cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { models?: { id: string; displayName?: string; name?: string; provider: string; accessPlans?: string[]; status?: string }[] };
        setModels((Array.isArray(data.models) ? data.models : [])
          .filter(m => m.status === "active")
          .map(m => ({
            id: m.id, name: m.displayName ?? m.name ?? m.id, provider: m.provider,
            accessPlans: Array.isArray(m.accessPlans) ? m.accessPlans : [],
          })));
      } catch { /* the picker stays empty; the form refuses to save without a model */ }
    })();
  }, [authHeaders]);

  const startEdit = (p: AdminPackage) => {
    // Carry EVERY field the form can write. A field the row does not hand over is submitted as
    // the default, so a missing one silently rewrites the package.
    setForm({
      id: p.id, name: p.name, description: p.description, category: p.category, tier: p.tier,
      durationDays: p.durationDays === null ? "" : String(p.durationDays),
      tokenCap: p.tokenCap ?? "", fairUseCap: p.fairUseCap ?? "",
      baseRpm: p.baseRpm === null ? "" : String(p.baseRpm),
      throttledRpm: p.throttledRpm === null ? "" : String(p.throttledRpm),
    });
    setModelIds(Array.isArray(p.modelIds) ? p.modelIds : []);
    setEditing(true);
    setNotice(null);
  };

  const resetForm = () => { setForm(EMPTY); setModelIds([]); setEditing(false); };

  const toggleModel = (id: string) => {
    setModelIds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const filteredModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
  }, [models, modelFilter]);

  const submit = async () => {
    setNotice(null);
    const id = form.id.trim();
    const name = form.name.trim();
    if (!name) { setNotice({ kind: "error", text: "Give the package a name." }); return; }
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(id)) {
      setNotice({ kind: "error", text: "Id: 2-63 chars, lowercase letters, digits, underscore, hyphen." });
      return;
    }
    if (modelIds.length === 0) {
      setNotice({ kind: "error", text: "Select at least one model this package covers." }); return;
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
          durationDays: form.durationDays.trim(), modelIds,
          tokenCap: form.category === "hard_cap" ? form.tokenCap.trim() : "",
          fairUseCap: form.category === "unlimited" ? form.fairUseCap.trim() : "",
          baseRpm: form.baseRpm.trim(), throttledRpm: form.throttledRpm.trim(),
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

  // ---- pricing plans CRUD ----
  const loadPlans = useCallback(async () => {
    setPlansStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/pricing-plans", { headers: await authHeaders(), cache: "no-store" });
      if (!res.ok) { setPlansStatus("error"); return; }
      const data = await res.json() as { pricingPlans?: PricingPlan[] };
      setPricingPlans(Array.isArray(data.pricingPlans) ? data.pricingPlans : []);
      setPlansStatus("ready");
    } catch { setPlansStatus("error"); }
  }, [authHeaders]);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  const startEditPlan = (p: PricingPlan) => {
    setPlanForm({
      displayName: p.displayName,
      displayDescription: p.displayDescription,
      features: [...p.features],
      priceIdr: String(p.priceIdr),
      priceCredits: p.priceCredits,
      paymentType: Number(p.priceCredits) > 0 && p.priceIdr > 0 ? "both" : Number(p.priceCredits) > 0 ? "credits" : "idr",
      packageId: p.packageId,
      sortOrder: String(p.sortOrder),
      isPublic: p.isPublic,
    });
    setEditingPlanId(p.id);
    setPlanModalOpen(true);
    setPlanNotice(null);
  };

  const resetPlanForm = () => {
    setPlanForm(EMPTY_PLAN);
    setEditingPlanId(null);
    setPlanModalOpen(false);
    setPlanNotice(null);
    setPlanFeatureInput("");
  };

  const addFeature = () => {
    const f = planFeatureInput.trim();
    if (!f) return;
    setPlanForm(prev => ({ ...prev, features: [...prev.features, f] }));
    setPlanFeatureInput("");
  };

  const removeFeature = (idx: number) => {
    setPlanForm(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== idx) }));
  };

  const submitPlan = async () => {
    setPlanNotice(null);
    const displayName = planForm.displayName.trim();
    if (!displayName) { setPlanNotice({ kind: "error", text: "Give the plan a display name." }); return; }
    if (!planForm.packageId) { setPlanNotice({ kind: "error", text: "Select a package to link." }); return; }

    const payload = {
      displayName,
      displayDescription: planForm.displayDescription.trim(),
      features: planForm.features,
      priceIdr: planForm.paymentType === "credits" ? "0" : (planForm.priceIdr.trim() || "0"),
      priceCredits: planForm.paymentType === "idr" ? "0" : (planForm.priceCredits.trim() || "0"),
      packageId: planForm.packageId,
      sortOrder: planForm.sortOrder.trim() || "0",
      isPublic: planForm.isPublic,
    };

    setSavingPlan(true);
    try {
      const url = editingPlanId
        ? `/backend/api/v1/admin/pricing-plans/${encodeURIComponent(editingPlanId)}`
        : "/backend/api/v1/admin/pricing-plans";
      const method = editingPlanId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: await authHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setPlanNotice({ kind: "error", text: body?.error?.message ?? "Could not save the pricing plan." });
        return;
      }
      setPlanNotice({ kind: "ok", text: `${displayName} saved.` });
      resetPlanForm();
      await loadPlans();
    } catch {
      setPlanNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setSavingPlan(false); }
  };

  const removePlan = async (p: PricingPlan) => {
    setBusyId(p.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/pricing-plans/${encodeURIComponent(p.id)}`, {
        method: "DELETE", headers: await authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setPlanNotice({ kind: "error", text: body?.error?.message ?? "Could not delete the pricing plan." });
        return;
      }
      setPlanNotice({ kind: "ok", text: `${p.displayName} deleted.` });
      await loadPlans();
    } catch {
      setPlanNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally { setBusyId(null); setConfirmDeletePlan(null); }
  };

  /** Package options for the plan form's select dropdown. */
  const packageOptions = useMemo(() => {
    // Exclude packages already linked to another pricing plan — one card per package.
    // When editing, allow the plan's own package to stay in the list.
    const usedPackageIds = new Set(
      pricingPlans.filter(p => p.id !== editingPlanId).map(p => p.packageId)
    );
    return packages
      .filter(p => !usedPackageIds.has(p.id))
      .map(p => ({ value: p.id, label: `${p.name} (${p.tier})` }));
  }, [packages, pricingPlans, editingPlanId]);

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

      {/* The ceiling is a raw digit string, and reading "200000000" to know it is 200M is a
          count-zeroes chore. State the reading under the field as it is typed. */}
      <div className="admin-form">
        {form.category === "hard_cap"
          ? field("Token ceiling", "tokenCap", "200000000", "Total tokens this package serves, then it ends.")
          : field("Fair-use threshold", "fairUseCap", "200000000", "Past this, the request rate drops (does not end).")}
      </div>
      <p className="admin-scale-note" aria-live="polite">
        {(() => {
          const raw = (form.category === "hard_cap" ? form.tokenCap : form.fairUseCap).trim();
          const n = Number(raw);
          if (raw === "" || !/^\d+$/.test(raw) || !Number.isFinite(n)) {
            return <><strong>—</strong> Enter a whole number of tokens.</>;
          }
          return <><strong>{formatTokens(n)}</strong> tokens{n >= 1_000_000 ? <> · {n.toLocaleString("en-US")}</> : null}</>;
        })()}
      </p>

      <div className="admin-form">
        {field("Base RPM", "baseRpm", "empty = unlimited", "Requests per minute before fair use.")}
        {form.category === "unlimited"
          ? field("Throttled RPM", "throttledRpm", "20", "Requests per minute past fair use.")
          : <label className="admin-field"><span>Throttled RPM</span><input value="" placeholder="n/a for hard cap" disabled /><small>A hard cap ends; it has no throttled leg.</small></label>}
      </div>

      {/* Coverage. A package's free allowance applies to exactly these models — a model not
          listed falls through to credits (or an event / a zero-priced model, which stay free). */}
      <div className="admin-subfield pkg-models">
        <span className="admin-subfield-label">Models covered <em>{modelIds.length} selected</em></span>
        <p className="admin-subfield-hint">The free allowance applies only to these models. Anything else bills to credits — events and zero-priced models stay free regardless.</p>
        <div className="pkg-models-toolbar">
          <label className="pkg-models-search"><Search size={15}/><input value={modelFilter} onChange={e => setModelFilter(e.target.value)} placeholder="Filter models…" aria-label="Filter models"/></label>
          <div className="pkg-models-actions">
            <button className="button button-outline compact-button" type="button" onClick={() => setModelIds(filteredModels.map(m => m.id))}>Select all</button>
            <button className="button button-outline compact-button" type="button" onClick={() => setModelIds([])} disabled={modelIds.length === 0}>Clear</button>
          </div>
        </div>
        <div className="pkg-models-list">
          {models.length === 0 && <div className="table-empty"><Layers size={18}/><strong>No models in the catalogue</strong><p>Add models first.</p></div>}
          {models.length > 0 && filteredModels.length === 0 && <div className="table-empty"><Search size={18}/><strong>No model matches “{modelFilter}”</strong></div>}
          {filteredModels.map(m => <label key={m.id} className={modelIds.includes(m.id) ? "pkg-model-row pkg-model-row-on" : "pkg-model-row"}>
            <input type="checkbox" checked={modelIds.includes(m.id)} onChange={() => toggleModel(m.id)}/>
            <span className="pkg-model-check">{modelIds.includes(m.id) ? <Check size={12}/> : null}</span>
            <span className="pkg-model-copy"><strong>{m.name}</strong><small><code>{m.id}</code> · {m.provider}</small></span>
            {m.accessPlans.length > 0 && <span className="pkg-model-plans">{m.accessPlans.map(p => <span key={p} className="plan-tag">{p}</span>)}</span>}
          </label>)}
        </div>
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
        <button className="button button-outline compact-button" type="button" onClick={() => { void load(); void loadSubscribers(); }}><RefreshCw size={15}/> Refresh</button>
      </div>

      <div className="model-table-wrap">
        {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading packages…</strong></div>}
        {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load packages</strong></div>}
        {status === "ready" && packages.length === 0 && <div className="table-empty">
          <Layers size={19}/><strong>No packages yet</strong><p>Create the first one above.</p>
        </div>}
        {status === "ready" && packages.length > 0 && <table className="model-table table-events">
          <thead><tr>
            <th>PACKAGE</th><th>CATEGORY</th><th>TIER</th><th>ALLOWANCE</th><th>RPM</th><th>MODELS</th><th>DURATION</th><th>LIVE</th><th></th>
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
            <td className="cell-num">
              <span title={p.modelIds.join(", ")}>{p.modelIds.length}</span>
              <small className="cell-sub">{p.modelIds.length === 1 ? "model" : "models"}</small>
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

    {/* Who is actually paying, and until when. The LIVE column above is a count; this is the
        names behind it, which is what an operator answers a support ticket with. */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">03</span><div>
          <h2>Active subscribers</h2>
          <p>Every account holding a package right now, with the day it lapses.</p>
        </div></div>
        <span className="period-badge">{subscribers.length} live</span>
      </div>

      <div className="model-table-wrap">
        {subsStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading subscribers…</strong></div>}
        {subsStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load subscribers</strong></div>}
        {subsStatus === "ready" && subscribers.length === 0 && <div className="table-empty">
          <Users size={19}/><strong>Nobody is subscribed</strong><p>Active packages will appear here the moment someone holds one.</p>
        </div>}
        {subsStatus === "ready" && subscribers.length > 0 && <table className="model-table table-events">
          <thead><tr>
            <th>ACCOUNT</th><th>PACKAGE</th><th>ALLOWANCE LEFT</th><th>STARTED</th><th>ENDS</th>
          </tr></thead>
          <tbody>{subscribers.map(s => {
            const cap = s.tokenCap === null ? null : Number(s.tokenCap);
            const used = Number(s.tokensUsed);
            const left = cap === null ? null : Math.max(0, cap - used);
            // Days left is the question a support ticket actually asks. Rounded up so "today"
            // does not read as zero while the window is still open.
            const daysLeft = s.expiresAt
              ? Math.ceil((new Date(s.expiresAt).getTime() - Date.now()) / 86_400_000)
              : null;
            return <tr key={`${s.userId}-${s.packageId}`}>
              <td>
                <strong>{s.name}</strong>
                <small className="cell-sub"><code>{s.email}</code></small>
              </td>
              <td>
                <strong>{s.packageName}</strong>
                <small className="cell-sub"><span className="plan-tag">{s.tier}</span></small>
              </td>
              <td className="cell-num">
                {left === null
                  ? <span className="cell-muted">fair use</span>
                  : <>{formatTokens(left)}<small className="cell-sub">of {formatTokens(cap ?? 0)}</small></>}
              </td>
              <td className="cell-num">{new Date(s.startedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td className="cell-num">
                {s.expiresAt
                  ? <>{new Date(s.expiresAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      <small className={daysLeft !== null && daysLeft <= 3 ? "cell-sub subs-soon" : "cell-sub"}>
                        {daysLeft === null ? "" : daysLeft <= 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                      </small></>
                  : <span className="cell-muted">no expiry</span>}
              </td>
            </tr>;
          })}</tbody>
        </table>}
      </div>
      <div className="table-note"><Users size={14}/> Live means the window is still open and allowance remains — a lapsed package is not listed here.</div>
    </section>

    {/* ---- Pricing cards: marketing layer over packages ---- */}
    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">04</span><div><h2>Pricing cards</h2><p>Marketing cards linked to packages — what the public pricing page shows.</p></div></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="button button-outline compact-button" type="button" onClick={() => void loadPlans()}><RefreshCw size={15}/> Refresh</button>
          <button className="button button-ink compact-button" type="button" onClick={() => { setPlanForm(EMPTY_PLAN); setEditingPlanId(null); setPlanModalOpen(true); setPlanNotice(null); setPlanFeatureInput(""); }}><Plus size={15}/> Create pricing card</button>
        </div>
      </div>

      {planNotice && <p className={planNotice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
        {planNotice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{planNotice.text}
      </p>}

      <div className="model-table-wrap">
        {plansStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading pricing cards…</strong></div>}
        {plansStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load pricing cards</strong></div>}
        {plansStatus === "ready" && pricingPlans.length === 0 && <div className="table-empty">
          <Layers size={19}/><strong>No pricing cards yet</strong><p>Create one to show it on the public pricing page.</p>
        </div>}
        {plansStatus === "ready" && pricingPlans.length > 0 && <table className="model-table table-events">
          <thead><tr>
            <th>DISPLAY NAME</th><th>PACKAGE</th><th>PRICE IDR</th><th>PRICE CREDITS</th><th>SORT</th><th>PUBLIC</th><th></th>
          </tr></thead>
          <tbody>{pricingPlans.map(p => <tr key={p.id}>
            <td>
              <strong>{p.displayName}</strong>
              <small className="cell-sub"><code>{p.id}</code></small>
            </td>
            <td>
              <strong>{p.packageName}</strong>
              <small className="cell-sub"><code>{p.packageId}</code></small>
            </td>
            <td className="cell-num">
              {p.priceIdr > 0 ? `Rp ${p.priceIdr.toLocaleString("id-ID")}` : <span className="cell-muted">free</span>}
            </td>
            <td className="cell-num">{p.priceCredits !== "0" && p.priceCredits !== "" ? p.priceCredits : <span className="cell-muted">—</span>}</td>
            <td className="cell-num">{p.sortOrder}</td>
            <td>{p.isPublic ? <span className="plan-tag">public</span> : <span className="cell-muted">hidden</span>}</td>
            <td>
              <span className="row-actions">
                <button className="row-action" type="button" title="Edit" aria-label={`Edit ${p.displayName}`} onClick={() => startEditPlan(p)} disabled={busyId === p.id}><Save size={14}/></button>
                <button className="row-action row-action-danger" type="button" title="Delete" aria-label={`Delete ${p.displayName}`} onClick={() => setConfirmDeletePlan(p)} disabled={busyId === p.id}>
                  {busyId === p.id ? <Loader2 size={14} className="row-spinner"/> : <Trash2 size={14}/>}
                </button>
              </span>
            </td>
          </tr>)}</tbody>
        </table>}
      </div>
      <div className="table-note"><AlertTriangle size={14}/> A pricing card is marketing copy over a package. Deleting it does not affect the package or any subscriptions.</div>
    </section>

    {/* Create / edit pricing plan modal */}
    <Modal open={planModalOpen} title={editingPlanId ? "Edit pricing card" : "Create pricing card"}
      subtitle={editingPlanId ? editingPlanId : slugifyPlan(planForm.displayName) || "auto-generated id"}
      onClose={resetPlanForm} wide
      footer={<>
        <button className="button button-outline" type="button" onClick={resetPlanForm}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => void submitPlan()} disabled={savingPlan}>
          {savingPlan ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <>{editingPlanId ? "Save card" : "Create card"} <Save size={15}/></>}
        </button>
      </>}>
      {planNotice && <p className={planNotice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status" style={{ marginBottom: 12 }}>
        {planNotice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{planNotice.text}
      </p>}
      <div className="admin-form">
        <label className="admin-field">
          <span>Display name</span>
          <input value={planForm.displayName} placeholder="Starter Plan"
            onChange={e => setPlanForm(f => ({ ...f, displayName: e.target.value }))} />
          <small>Shown as the card title on the public pricing page.</small>
        </label>
      </div>
      <div className="admin-form">
        <label className="admin-field">
          <span>Display description</span>
          <textarea value={planForm.displayDescription} placeholder="Perfect for getting started with AI APIs."
            rows={2}
            onChange={e => setPlanForm(f => ({ ...f, displayDescription: e.target.value }))} />
          <small>One or two lines under the title.</small>
        </label>
      </div>

      {/* Features: a tag editor — type a feature, press Enter or click Add. */}
      <div className="admin-subfield">
        <span className="admin-subfield-label">Features <em>{planForm.features.length} listed</em></span>
        <p className="admin-subfield-hint">Bullet points shown on the card. Type one and press Enter.</p>
        <div className="pkg-models-toolbar">
          <input value={planFeatureInput}
            onChange={e => setPlanFeatureInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }}
            placeholder="Add a feature…"
            className="admin-field-input"
            style={{ flex: 1, height: 36, padding: "0 10px", border: "1.5px solid #d8d1c5", background: "#fff", fontSize: "var(--fs-small)" }}
          />
          <button className="button button-outline compact-button" type="button" onClick={addFeature} disabled={!planFeatureInput.trim()}><Plus size={14}/> Add</button>
        </div>
        {planForm.features.length > 0 && <div className="plan-features-list">
          {planForm.features.map((f, idx) => <span key={idx} className="plan-feature-chip">
            <Check size={11}/> {f}
            <button type="button" onClick={() => removeFeature(idx)} aria-label="Remove feature"><X size={11}/></button>
          </span>)}
        </div>}
      </div>

      <div className="admin-form">
        <label className="admin-field">
          <span>Payment method</span>
          <Select label="Payment method" value={planForm.paymentType}
            onChange={v => setPlanForm(f => ({ ...f, paymentType: v as PlanForm["paymentType"] }))}
            options={[
              { value: "idr", label: "IDR (Kasir)" },
              { value: "credits", label: "Credits" },
              { value: "both", label: "IDR + Credits" },
            ]} />
          <small>{planForm.paymentType === "idr" ? "Bayar lewat kasir (Rupiah)." : planForm.paymentType === "credits" ? "Charge dari balance credits user." : "Pembeli pilih bayar Rupiah atau credits."}</small>
        </label>
      </div>
      <div className="admin-form">
        {(planForm.paymentType === "idr" || planForm.paymentType === "both") && (
          <label className="admin-field">
            <span>Price IDR</span>
            <input value={planForm.priceIdr} placeholder="0" type="number" min={0}
              onChange={e => setPlanForm(f => ({ ...f, priceIdr: e.target.value }))} />
            <small>0 = free. Formatted as Rp on the card.</small>
          </label>
        )}
        {(planForm.paymentType === "credits" || planForm.paymentType === "both") && (
          <label className="admin-field">
            <span>Price credits</span>
            <input value={planForm.priceCredits} placeholder="0"
              onChange={e => setPlanForm(f => ({ ...f, priceCredits: e.target.value }))} />
            <small>Credit cost charged from user balance.</small>
          </label>
        )}
      </div>
      <div className="admin-form">
        <label className="admin-field">
          <span>Linked package</span>
          <Select label="Linked package" value={planForm.packageId}
            onChange={v => setPlanForm(f => ({ ...f, packageId: v }))}
            options={packageOptions} placeholder="Select a package…" />
          <small>The package provides the actual entitlement.</small>
        </label>
        <label className="admin-field">
          <span>Sort order</span>
          <input value={planForm.sortOrder} placeholder="0" type="number"
            onChange={e => setPlanForm(f => ({ ...f, sortOrder: e.target.value }))} />
          <small>Lower = appears first on the pricing page.</small>
        </label>
      </div>
      <div className="admin-form">
        <label className="admin-field">
          <span>Public</span>
          <div className="toggle-row" style={{ cursor: "pointer" }} onClick={() => setPlanForm(f => ({ ...f, isPublic: !f.isPublic }))}>
            <span className={"toggle" + (planForm.isPublic ? " toggle-on" : "")} />
            <span className="toggle-label"><strong>{planForm.isPublic ? "Visible" : "Hidden"}</strong><small>Hidden cards don't appear on the public page.</small></span>
          </div>
        </label>
      </div>
    </Modal>

    {/* Delete pricing plan confirmation */}
    <Modal open={confirmDeletePlan !== null} tone="danger" title="Delete this pricing card?"
      subtitle={confirmDeletePlan ? confirmDeletePlan.id : ""} onClose={() => setConfirmDeletePlan(null)}
      footer={<>
        <button className="button button-outline" type="button" onClick={() => setConfirmDeletePlan(null)}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => confirmDeletePlan && void removePlan(confirmDeletePlan)} disabled={busyId !== null}>
          {busyId !== null ? <Loader2 size={15} className="row-spinner"/> : <Trash2 size={15}/>} Delete
        </button>
      </>}>
      {confirmDeletePlan && <div className="events-dialog">
        <p><AlertTriangle size={15}/> <span><strong>{confirmDeletePlan.displayName}</strong> will be removed from the public pricing page. The linked package and any subscriptions are unaffected.</span></p>
        <div className="modal-danger-note">
          <strong>Cannot be undone</strong>
          <span>The card stops appearing on the pricing page immediately. Recreate it if needed.</span>
        </div>
      </div>}
    </Modal>

    {/* Delete package confirmation */}
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
