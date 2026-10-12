"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ProviderMark } from "@/components/provider-mark";
import { Modal } from "@/components/modal";
import { AlertTriangle, Brain, Check, Eye, Layers, Loader2, Pencil, PenLine, Plus, RefreshCw, Server, Trash2, Wrench, X } from "lucide-react";

const ALL_PLANS = ["STANDARD", "SUBSCRIPTION", "SUPERUSER"] as const;
type Plan = (typeof ALL_PLANS)[number];

type ModelRow = {
  id: string;
  upstreamModelId: string;
  displayName: string;
  provider: string;
  contextLength: number | null;
  status: string;
  priceInputCredits: number;
  priceOutputCredits: number;
  /** Derived server-side from the id prefix; read-only here. */
  node: string | null;
  accessPlans: string[];
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
};

type Capability = "supportsVision" | "supportsReasoning" | "supportsTools";
type Status = "loading" | "ready" | "error";

const EMPTY_FORM = {
  id: "",
  upstreamModelId: "",
  displayName: "",
  provider: "",
  contextLength: "",
  priceInputCredits: "",
  priceOutputCredits: "",
  accessPlans: ["STANDARD", "SUBSCRIPTION"] as string[],
  status: "active" as string,
  supportsVision: false,
  supportsReasoning: false,
  supportsTools: false,
};

/** The three capability flags, each with the icon the operator asked for. */
/**
 * Provider mark for the table.
 *
 * Provider is a display concern only — routing uses upstreamModelId — so it appears as
 * an avatar, not as text. Assets live in public/providers/<slug>.svg (see README);
 * until one exists the initial stands in, so a new provider still looks intentional.
 */
/**
 * Compact context length for the table: 1000000 -> "1M", 262144 -> "262K".
 *
 * Floor for K so a size never reads larger than it is (262144 is not 263K of usable
 * context). M keeps one decimal only when there is one — 1M, not 1.0M.
 */
const formatContext = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${Math.round(n / 100_000) / 10}M`;
};

const CAPABILITIES: { key: Capability; label: string; hint: string; Icon: typeof Eye }[] = [
  { key: "supportsVision", label: "Vision", hint: "Accepts image input", Icon: Eye },
  { key: "supportsReasoning", label: "Reasoning", hint: "Extended thinking", Icon: Brain },
  { key: "supportsTools", label: "Tool call", hint: "Function calling", Icon: Wrench },
];

export default function AdminModelsPage() {
  const { getToken } = useAuth();
  const [models, setModels] = useState<ModelRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Non-null while an existing entry is loaded into the form. Save then PATCHes it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The model awaiting deletion, or null. Cleared by the dialog. */
  const [confirmRemove, setConfirmRemove] = useState<ModelRow | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" };
  }, [getToken]);

  const loadModels = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/admin/models", { headers: await authHeaders() });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { models?: unknown };
      const rows = Array.isArray(data.models) ? data.models as ModelRow[] : [];
      // Normalise on the way in: an older backend, or a column added later, must not
      // turn the table into a crash. Every list the UI maps over is coerced here.
      setModels(rows.map(row => ({
        ...row,
        accessPlans: Array.isArray(row.accessPlans) ? row.accessPlans : [],
        node: row.node ?? null,
        supportsVision: row.supportsVision === true,
        supportsReasoning: row.supportsReasoning === true,
        supportsTools: row.supportsTools === true,
      })));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void loadModels(); }, [loadModels]);

  const togglePlan = (plan: Plan) =>
    setForm(f => ({
      ...f,
      accessPlans: f.accessPlans.includes(plan)
        ? f.accessPlans.filter(p => p !== plan)
        : [...f.accessPlans, plan],
    }));

  const toggleCap = (key: Capability) => setForm(f => ({ ...f, [key]: !f[key] }));

  /** Echo the simplified form back while typing, so the table value is never a surprise. */
  const contextHint = () => {
    const raw = form.contextLength.trim();
    if (raw === "") return "Optional";
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) return "Optional";
    return `Shown as ${formatContext(n)}`;
  };

  const blankForm = () => ({ ...EMPTY_FORM, accessPlans: [...EMPTY_FORM.accessPlans] });

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
  };

  /** Load an existing row into the form. Editing is just filling the same fields. */
  const startEdit = (row: ModelRow) => {
    setNotice(null);
    setEditingId(row.id);
    setForm({
      id: row.id,
      upstreamModelId: row.upstreamModelId,
      displayName: row.displayName,
      provider: row.provider,
      contextLength: row.contextLength === null ? "" : String(row.contextLength),
      priceInputCredits: String(row.priceInputCredits ?? 0),
      priceOutputCredits: String(row.priceOutputCredits ?? 0),
      accessPlans: [...(row.accessPlans ?? [])],
      // Carried through the form. Omitting it here would send no status on save, the
      // backend would default to active, and editing a disabled model would quietly
      // republish it — a write the operator did not ask for.
      status: row.status === "inactive" ? "inactive" : "active",
      supportsVision: row.supportsVision,
      supportsReasoning: row.supportsReasoning,
      supportsTools: row.supportsTools,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (row: ModelRow) => {
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/models/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not remove the model." });
        return;
      }
      setNotice({ kind: "ok", text: `${row.displayName} removed.` });
      setConfirmRemove(null);
      if (editingId === row.id) resetForm();
      await loadModels();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
    }
  };

  const submit = async () => {
    setNotice(null);
    if (!form.upstreamModelId.trim() || !form.displayName.trim() || !form.provider.trim()) {
      setNotice({ kind: "error", text: "Upstream model ID, display name and provider are required." });
      return;
    }
    if (!editingId && !form.id.trim()) {
      setNotice({ kind: "error", text: "Model ID is required." });
      return;
    }
    if (form.accessPlans.length === 0) {
      setNotice({ kind: "error", text: "Select at least one plan that may use this model." });
      return;
    }
    const priceIn = form.priceInputCredits.trim();
    const priceOut = form.priceOutputCredits.trim();
    for (const [label, value] of [["Input price", priceIn], ["Output price", priceOut]] as const) {
      if (value !== "" && (!/^\d+$/.test(value))) {
        setNotice({ kind: "error", text: `${label} must be a whole number of micro-credits per 1M tokens.` });
        return;
      }
    }
    setSaving(true);
    try {
      const url = editingId
        ? `/backend/api/v1/admin/models/${encodeURIComponent(editingId)}`
        : "/backend/api/v1/admin/models";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          id: form.id.trim(),
          upstreamModelId: form.upstreamModelId.trim(),
          displayName: form.displayName.trim(),
          provider: form.provider.trim(),
          contextLength: form.contextLength.trim() === "" ? null : Number(form.contextLength.trim()),
          priceInputCredits: priceIn === "" ? 0 : Number(priceIn),
          priceOutputCredits: priceOut === "" ? 0 : Number(priceOut),
          accessPlans: form.accessPlans,
          status: form.status,
          supportsVision: form.supportsVision,
          supportsReasoning: form.supportsReasoning,
          supportsTools: form.supportsTools,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        // 409 means the id is taken. Say that plainly instead of a generic failure.
        const text = res.status === 409
          ? (body?.error?.message ?? "That model ID is already taken.")
          : (body?.error?.message ?? "Could not save the model.");
        setNotice({ kind: "error", text });
        return;
      }
      setNotice({ kind: "ok", text: editingId ? `${form.displayName.trim()} updated.` : `${form.displayName.trim()} saved.` });
      resetForm();
      await loadModels();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: "id" | "upstreamModelId" | "displayName" | "provider" | "contextLength" | "priceInputCredits" | "priceOutputCredits",
    placeholder: string,
    hint?: string,
    disabled = false,
  ) =>
    <label className={disabled ? "admin-field admin-field-locked" : "admin-field"}>
      <span>{label}</span>
      <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} disabled={disabled}/>
      {hint && <small>{hint}</small>}
    </label>;

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><Layers size={14}/> ADMIN / MODELS</div><h1>Models</h1><p>Publish a model to the Devora catalogue and map it to an upstream provider.</p></div></div>

    <section className="console-section"><div className="section-title-row"><div><span className="section-index">01</span><div><h2>{editingId ? "Edit model" : "Add a model"}</h2><p>The public ID is what clients send; the upstream ID is what the provider accepts.</p></div></div></div>
      <div className="admin-form">
        {field("Model ID", "id", "devora-01/deepseek/deepseek-v4-flash",
          editingId ? "The id is the key — it cannot change. Delete and re-add to rename." : "Clients call this. The first segment before / becomes the node.",
          Boolean(editingId))}
        {field("Upstream model ID", "upstreamModelId", "or/deepseek/deepseek-v4.1-flash", "What the provider actually accepts.")}
        {field("Display name", "displayName", "DeepSeek V4.1 Flash")}
        {field("Provider", "provider", "OpenRouter")}
        {field("Context length", "contextLength", "262144", contextHint())}
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Pricing</span>
        <p className="admin-subfield-hint">Credits per 1M tokens. Leave blank for free. Fractional values are allowed, e.g. 0.14.</p>
        <div className="admin-form admin-form-tight">
          {field("Input price", "priceInputCredits", "140", "Credits per 1M prompt tokens")}
          {field("Output price", "priceOutputCredits", "280", "Credits per 1M completion tokens")}
        </div>
      </div>

      {/* Two states, not a checkbox. A checkbox would read as "is this thing on?" and leave
          the other state unnamed; the pair says what each one does, which is what makes the
          consequence legible before saving. */}
      <div className="admin-subfield">
        <span className="admin-subfield-label">Status</span>
        <p className="admin-subfield-hint">A model that is inactive leaves the catalogue and stops routing.</p>
        <div className="md-status-pills">
          {(["active", "inactive"] as const).map(next => <button
            key={next}
            type="button"
            className={form.status === next ? `md-status-pill md-status-pill-on md-status-pill-${next}` : "md-status-pill"}
            aria-pressed={form.status === next}
            onClick={() => setForm(f => ({ ...f, status: next }))}
          >{next}</button>)}
        </div>
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Plan access</span>
        <p className="admin-subfield-hint">Which account plans may call this model.</p>
        <div className="plan-pills">
          {ALL_PLANS.map(plan => <button
            key={plan}
            type="button"
            className={form.accessPlans.includes(plan) ? "plan-pill plan-pill-on" : "plan-pill"}
            aria-pressed={form.accessPlans.includes(plan)}
            onClick={() => togglePlan(plan)}
          >{plan}</button>)}
        </div>
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Capabilities</span>
        <p className="admin-subfield-hint">Shown as badges in the console.</p>
        <div className="cap-tiles">
          {CAPABILITIES.map(({ key, label, hint, Icon }) => <button
            key={key}
            type="button"
            className={form[key] ? "cap-tile cap-tile-on" : "cap-tile"}
            aria-pressed={form[key]}
            onClick={() => toggleCap(key)}
          >
            <span className="cap-tile-flag">{form[key] ? "ON" : "OFF"}</span>
            <span className="cap-tile-icon"><Icon size={18}/></span>
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>)}
        </div>
      </div>

      {editingId && <p className="admin-editing-note"><PenLine size={13}/> Editing <code>{editingId}</code></p>}
      <div className="admin-actions">
        <button className="button button-ink" type="button" onClick={() => void submit()} disabled={saving}>{saving ? <><Loader2 size={15} className="row-spinner"/> Saving…</> : <>{editingId ? "Save changes" : "Save model"} <Plus size={16}/></>}</button>
        {editingId && <button className="button button-outline" type="button" onClick={resetForm} disabled={saving}>Cancel</button>}
        {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">{notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}</p>}
      </div>
    </section>

    <section className="console-section"><div className="section-title-row"><div><span className="section-index">02</span><div><h2>Models</h2><p>Active entries are live; inactive ones are hidden and return 404.</p></div></div><button className="button button-outline compact-button" type="button" onClick={() => void loadModels()}><RefreshCw size={15}/> Refresh</button></div>
      <div className="model-table-wrap">
        {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading models…</strong><p>Reading the catalogue.</p></div>}
        {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load models</strong><p>The catalogue is unavailable right now.</p></div>}
        {status === "ready" && (models.length === 0
          ? <div className="table-empty"><Layers size={19}/><strong>No models yet</strong><p>Add the first model above.</p></div>
          : <table className="model-table"><thead><tr><th>PROVIDER</th><th>MODEL</th><th>NODE</th><th>STATUS</th><th>PLANS</th><th>CAPABILITIES</th><th>PRICING /1M</th><th>UPSTREAM ID</th><th>CONTEXT</th><th></th></tr></thead><tbody>{models.map(m => <tr key={m.id}>
            <td><ProviderMark provider={m.provider}/></td>
            <td><strong>{m.displayName}</strong><small className="cell-sub"><code>{m.id}</code></small></td>
            <td>{m.node ? <code>{m.node}</code> : "—"}</td>
            <td><span className={m.status === "inactive" ? "md-status-tag md-status-tag-off" : "md-status-tag"}>{m.status === "inactive" ? "inactive" : "active"}</span></td>
            <td><span className="plan-list">{(m.accessPlans ?? []).map(p => <span key={p} className="plan-tag">{p}</span>)}</span></td>
            <td><span className="cap-list">
              {m.supportsVision && <span className="cap-badge" title="Vision"><Eye size={14}/></span>}
              {m.supportsReasoning && <span className="cap-badge" title="Reasoning"><Brain size={14}/></span>}
              {m.supportsTools && <span className="cap-badge" title="Tool call"><Wrench size={14}/></span>}
              {!m.supportsVision && !m.supportsReasoning && !m.supportsTools && <span className="cap-none">—</span>}
            </span></td>
            <td><span className="price-pair"><span className="price-in">↓ {m.priceInputCredits.toLocaleString()}</span><span className="price-out">↑ {m.priceOutputCredits.toLocaleString()}</span></span></td>
            <td><code>{m.upstreamModelId}</code></td>
            <td>{m.contextLength ? formatContext(m.contextLength) : "—"}</td>
            <td><span className="row-actions">
              <button className="row-action" type="button" title="Edit" aria-label={`Edit ${m.displayName}`} onClick={() => startEdit(m)} disabled={busyId === m.id}><Pencil size={14}/></button>
              <button className="row-action row-action-danger" type="button" title="Delete" aria-label={`Delete ${m.displayName}`} onClick={() => setConfirmRemove(m)} disabled={busyId === m.id}>{busyId === m.id ? <Loader2 size={14} className="row-spinner"/> : <Trash2 size={14}/>}</button>
            </span></td>
          </tr>)}</tbody></table>)}
      </div>
      <div className="table-note"><Server size={14}/> Routing is resolved server-side from this catalogue.</div>
    </section>

    <Modal
      open={confirmRemove !== null}
      tone="danger"
      title="Remove model"
      subtitle="Clients calling this id stop resolving immediately."
      busy={busyId !== null}
      onClose={() => setConfirmRemove(null)}
      footer={<>
        <button className="button button-outline compact-button" type="button" onClick={() => setConfirmRemove(null)} disabled={busyId !== null}>Cancel</button>
        <button
          className="button button-ink compact-button"
          type="button"
          disabled={busyId !== null}
          onClick={() => { if (confirmRemove) void remove(confirmRemove); }}
        >
          {busyId !== null ? <><Loader2 size={13} className="row-spinner"/> Removing…</> : "Remove model"}
        </button>
      </>}
    >
      {confirmRemove && <>
        <div className="modal-subject">
          <strong>{confirmRemove.displayName}</strong>
          <small><code>{confirmRemove.id}</code></small>
        </div>
        <div className="modal-danger-note"><AlertTriangle size={15}/>
          <span>Any request to <strong>{confirmRemove.id}</strong> will return <strong>404</strong> once this is removed.</span>
        </div>
      </>}
    </Modal>
  </div>;
}
