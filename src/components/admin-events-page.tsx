"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertTriangle, Ban, CalendarClock, Check, Flame, Layers, Loader2, Plus, RefreshCw, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { formatTokens } from "@/lib/tokens";

type EventState = "running" | "upcoming" | "ended" | "exhausted" | "disabled" | "orphaned";

/** Which sort of event this is. Decides which fields are required, nothing else. */
type EventKind = "announcement" | "model_budget";

type Highlight = { label: string; value: string };

type AdminEvent = {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: EventKind;
  state: EventState;
  status: string;
  highlights: Highlight[];
  cta: { label: string; href: string } | null;
  priority: number;
  modelId: string | null;
  modelName: string | null;
  /** The referenced model's status. Anything but "active" means the event points at a model
   *  nobody can call — the public page hides these, so the console is the only place they show. */
  modelStatus: string | null;
  budgetTokens: string | null;
  tokensUsed: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  createdAt: string;
};

/**
 * The kinds an operator can create, with the label and the one-line explanation shown beside
 * the choice. A closed list, mirroring the server's — the value decides which fields are
 * required and, for `model_budget`, whether the gateway enforces a budget at all.
 */
const KINDS: { value: EventKind; label: string; hint: string }[] = [
  { value: "announcement", label: "Announcement", hint: "A notice on the public page. No effect on models or billing." },
  { value: "model_budget", label: "Free model (token budget)", hint: "Frees one model until its budget or deadline runs out." },
];

type ModelOption = {
  id: string;
  displayName: string;
  provider: string;
  contextLength: number | null;
  priceInputCredits: number;
  priceOutputCredits: number;
  accessPlans: string[];
};

/** Preset durations, because "7 or 30 days" is what an operator actually reaches for. */
const DURATIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** Budget magnitudes. The number and the unit are separate fields so "1 B" is one click. */
const MAGNITUDES = [
  { value: "1000", label: "thousand (K)" },
  { value: "1000000", label: "million (M)" },
  { value: "1000000000", label: "billion (B)" },
];

const STATE_LABEL: Record<EventState, string> = {
  running: "Live",
  upcoming: "Upcoming",
  exhausted: "Budget spent",
  ended: "Ended",
  disabled: "Disabled",
  // Not a lifecycle state — a fault. The event is active by its own clock but its model is no
  // longer published, so it is invisible to the public and can never serve a request.
  orphaned: "Model unavailable",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 63);
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function AdminEventsPage() {
  const { getToken } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState<AdminEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminEvent | null>(null);
  const [editing, setEditing] = useState<AdminEvent | null>(null);
  // The edit form is separate from the create form: they share fields but not meaning, and
  // binding them together would make a typo in one show up in the other.
  const [edit, setEdit] = useState({ budgetNumber: "1", budgetMagnitude: "1000000000", extendDays: "7" });
  const [editError, setEditError] = useState("");

  const [form, setForm] = useState({
    kind: "announcement" as EventKind,
    title: "",
    slug: "",
    description: "",
    modelId: "",
    budgetNumber: "1",
    budgetMagnitude: "1000000000",
    durationDays: "7",
    ctaLabel: "",
    ctaHref: "",
  });
  // Up to three operator-written facts. Kept as a fixed-length array rather than a
  // push/remove list: three is what fits a card, and a stable row count keeps the form
  // from shifting under the cursor as you type.
  const [facts, setFacts] = useState<Highlight[]>([
    { label: "", value: "" }, { label: "", value: "" }, { label: "", value: "" },
  ]);
  // Once the operator edits the link by hand, stop deriving it from the title — otherwise
  // their own choice would be overwritten on the next keystroke.
  const [slugTouched, setSlugTouched] = useState(false);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const headers = await authHeaders();
      const [evRes, mdRes] = await Promise.all([
        fetch("/backend/api/v1/admin/events", { headers, cache: "no-store" }),
        fetch("/backend/api/v1/admin/models", { headers, cache: "no-store" }),
      ]);
      if (!evRes.ok || !mdRes.ok) { setStatus("error"); return; }
      const evData = await evRes.json() as { events?: AdminEvent[] };
      const mdData = await mdRes.json() as { models?: ModelOption[] };
      setEvents(Array.isArray(evData.events) ? evData.events : []);
      setModels(Array.isArray(mdData.models) ? mdData.models : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const setTitle = (value: string) => setForm(f => ({
    ...f,
    title: value,
    slug: slugTouched ? f.slug : slugify(value),
  }));

  const totalBudget = () => {
    const n = Number(form.budgetNumber);
    const m = Number(form.budgetMagnitude);
    if (!Number.isFinite(n) || !Number.isFinite(m) || n <= 0) return "0";
    // Tokens are whole. A fractional count is meaningless, so it is rounded rather than sent
    // as a decimal the backend would reject.
    return String(Math.round(n * m));
  };

  const submit = async () => {
    setNotice(null);
    const title = form.title.trim();
    const slug = form.slug.trim();
    const budget = totalBudget();

    if (!title) { setNotice({ kind: "error", text: "Give the event a title." }); return; }
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      setNotice({ kind: "error", text: "The link needs 2-63 characters: lowercase letters, digits and hyphens." });
      return;
    }
    // A model event is the only kind that names a model and carries a budget. The server
    // enforces the same pairing; checking here turns a rejection into a field-level message.
    if (form.kind === "model_budget") {
      if (!form.modelId) { setNotice({ kind: "error", text: "Pick the model this event applies to." }); return; }
      if (budget === "0") { setNotice({ kind: "error", text: "The budget must be greater than zero." }); return; }
    }

    setSaving(true);
    try {
      const res = await fetch("/backend/api/v1/admin/events", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          kind: form.kind,
          title,
          slug,
          description: form.description.trim(),
          // Sent only for a model event. Sending them otherwise would be rejected by the
          // server's pairing rule, and sending them empty would be noise.
          modelId: form.kind === "model_budget" ? form.modelId : "",
          budgetTokens: form.kind === "model_budget" ? budget : "",
          highlights: facts.filter(f => f.label.trim() && f.value.trim()),
          ctaLabel: form.ctaLabel.trim(),
          ctaHref: form.ctaHref.trim(),
          durationDays: form.durationDays,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not create the event." });
        return;
      }
      setNotice({ kind: "ok", text: `${title} is live.` });
      setForm({ kind: "announcement", title: "", slug: "", description: "", modelId: "", budgetNumber: "1", budgetMagnitude: "1000000000", durationDays: "7", ctaLabel: "", ctaHref: "" });
      setFacts([{ label: "", value: "" }, { label: "", value: "" }, { label: "", value: "" }]);
      setSlugTouched(false);
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Top up an event's budget, push its deadline out, or bring it back.
   *
   * Sends only what the operator actually changed, because the server ADDS rather than SETS:
   * an empty field must not be read as "add nothing" when the other one carries a value, and it
   * must not be sent as zero either. Opening the dialog and saving unchanged sends nothing, which
   * the server refuses with a readable message rather than writing a no-op.
   */
  const saveEdit = async () => {
    if (!editing) return;
    setEditError("");

    const n = Number(edit.budgetNumber);
    const m = Number(edit.budgetMagnitude);
    const days = Number(edit.extendDays);

    // A non-model event has no budget to add — the server's pairing rule forbids one. Extending
    // its window is still meaningful, so this is a note rather than a block.
    const supportsBudget = editing.kind === "model_budget";
    const addBudget = supportsBudget && Number.isFinite(n) && n > 0
      ? String(Math.round(n * m))
      : null;
    const extendDays = Number.isFinite(days) && days > 0 ? String(Math.round(days)) : null;
    const activate = editing.status === "disabled";

    if (addBudget === null && extendDays === null && !activate) {
      setEditError("Nothing to change — add tokens, days, or reactivate.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/backend/api/v1/admin/events/${editing.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ addBudgetTokens: addBudget, extendDays, activate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setEditError(body?.error?.message ?? "Could not update the event.");
        return;
      }
      const data = await res.json() as { applied?: string };
      setNotice({ kind: "ok", text: `${editing.title}: ${data.applied ?? "updated"}.` });
      setEditing(null);
      await load();
    } catch {
      setEditError("Could not reach the gateway.");
    } finally {
      setSaving(false);
    }
  };

  const stopEvent = async (row: AdminEvent) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/events/${row.id}/disable`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not stop the event." });
        return;
      }
      setNotice({ kind: "ok", text: `${row.title} stopped. The model is back to normal.` });
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
      setConfirmStop(null);
    }
  };

  const deleteEvent = async (row: AdminEvent) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/backend/api/v1/admin/events/${row.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setNotice({ kind: "error", text: body?.error?.message ?? "Could not delete the event." });
        return;
      }
      setNotice({ kind: "ok", text: `${row.title} deleted.${row.modelId ? " The model is back to normal." : ""}` });
      await load();
    } catch {
      setNotice({ kind: "error", text: "Could not reach the gateway." });
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const selectedModel = models.find(m => m.id === form.modelId);
  const field = (label: string, key: keyof typeof form, placeholder: string, hint?: string) =>
    <label className="admin-field">
      <span>{label}</span>
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={e => {
          const v = e.target.value;
          if (key === "title") setTitle(v);
          else setForm(f => ({ ...f, [key]: v }));
        }}
      />
      {hint && <small>{hint}</small>}
    </label>;

  return <div className="page-stack">
    <div className="page-heading">
      <div>
        <div className="eyebrow small-eyebrow"><Flame size={14}/> ADMIN / EVENTS</div>
        <h1>Events</h1>
        <p>Give a model a token budget for a fixed window. When it ends, the model goes back to normal.</p>
      </div>
    </div>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">01</span><div><h2>Create an event</h2><p>One model, one budget, one deadline.</p></div></div>
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Event type</span>
        <p className="admin-subfield-hint">Decides what the card shows, and whether a model is affected.</p>
        <div className="kind-tiles">
          {KINDS.map(k => <button
            key={k.value}
            type="button"
            className={form.kind === k.value ? "kind-tile kind-tile-on" : "kind-tile"}
            aria-pressed={form.kind === k.value}
            onClick={() => setForm(f => ({ ...f, kind: k.value }))}
          >
            <span className="kind-tile-flag">{form.kind === k.value ? "SELECTED" : ""}</span>
            <strong>{k.label}</strong>
            <small>{k.hint}</small>
          </button>)}
        </div>
      </div>

      <div className="admin-form">
        {field("Event title", "title", "Free V4.1 Flash Weekend", "Shown on the public events page.")}
        <label className="admin-field">
          <span>Public link</span>
          <input
            value={form.slug}
            placeholder="free-v41-weekend"
            onChange={e => { setSlugTouched(true); setForm(f => ({ ...f, slug: slugify(e.target.value) })); }}
          />
          <small>/events/{form.slug || "…"}</small>
        </label>
      </div>

      <div className="admin-form">
        {field("Description", "description", "Try DeepSeek V4.1 Flash free for a week. No credits, no card.", "Optional. One line is enough.")}
      </div>

      {form.kind === "model_budget" && <>
      <div className="admin-subfield">
        <span className="admin-subfield-label">Model</span>
        <p className="admin-subfield-hint">The event applies to this model alone.</p>
        <Select
          label="Model this event applies to"
          value={form.modelId}
          onChange={v => setForm(f => ({ ...f, modelId: v }))}
          placeholder="Select a model…"
          options={models.map(m => ({ value: m.id, label: `${m.displayName} · ${m.id}` }))}
        />
        {selectedModel && <div className="event-model-preview">
          <div className="event-model-preview-id"><code>{selectedModel.id}</code></div>
          <div className="event-model-preview-meta">
            <span>{selectedModel.provider}</span>
            {selectedModel.contextLength && <span>· {formatTokens(selectedModel.contextLength)} ctx</span>}
            <span>· ↓ {selectedModel.priceInputCredits.toLocaleString()} / ↑ {selectedModel.priceOutputCredits.toLocaleString()} credits per 1M</span>
          </div>
          <div className="event-model-preview-plans">
            {selectedModel.accessPlans.map(p => <span key={p} className="plan-tag">{p}</span>)}
          </div>
        </div>}
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Token budget</span>
        <p className="admin-subfield-hint">How many tokens the event may serve in total, across every account.</p>
        <div className="budget-picker">
          <input
            className="budget-number"
            inputMode="decimal"
            value={form.budgetNumber}
            onChange={e => setForm(f => ({ ...f, budgetNumber: e.target.value.replace(/[^\d.]/g, "") }))}
          />
          <Select
            label="Budget magnitude"
            value={form.budgetMagnitude}
            onChange={v => setForm(f => ({ ...f, budgetMagnitude: v }))}
            options={MAGNITUDES}
            width={168}
          />
          <span className="budget-total">= {Number(totalBudget()).toLocaleString()} tokens</span>
        </div>
      </div>

      <div className="admin-subfield">
        <span className="admin-subfield-label">Duration</span>
        <p className="admin-subfield-hint">Counted from the moment you create it.</p>
        <div className="budget-picker">
          <Select
            label="Event duration"
            value={DURATIONS.some(d => d.value === form.durationDays) ? form.durationDays : "custom"}
            onChange={v => setForm(f => ({ ...f, durationDays: v === "custom" ? "" : v }))}
            options={[...DURATIONS, { value: "custom", label: "Custom…" }]}
            width={168}
          />
          {!DURATIONS.some(d => d.value === form.durationDays) && <input
            className="budget-number"
            inputMode="numeric"
            placeholder="Days"
            value={form.durationDays}
            onChange={e => setForm(f => ({ ...f, durationDays: e.target.value.replace(/\D/g, "") }))}
          />}
        </div>
      </div>
      </>}

      <div className="admin-subfield">
        <span className="admin-subfield-label">Highlights</span>
        <p className="admin-subfield-hint">Optional. Up to three facts shown on the card — a date, a number, a tier.</p>
        <div className="facts-grid">
          {facts.map((f, i) => <div key={i} className="fact-row">
            <input
              className="fact-label"
              placeholder="Label"
              value={f.label}
              onChange={e => setFacts(a => a.map((x, n) => n === i ? { ...x, label: e.target.value } : x))}
            />
            <input
              className="fact-value"
              placeholder="Value"
              value={f.value}
              onChange={e => setFacts(a => a.map((x, n) => n === i ? { ...x, value: e.target.value } : x))}
            />
          </div>)}
        </div>
      </div>

      <div className="admin-form">
        {field("Button label", "ctaLabel", "Read the changelog", "Optional. Needs a link to appear.")}
        {field("Button link", "ctaHref", "/console/billing", "Where the button goes. Both or neither.")}
      </div>

      <div className="admin-actions">
        <button className="button button-ink" type="button" onClick={() => void submit()} disabled={saving}>
          {saving ? <><Loader2 size={15} className="row-spinner"/> Starting…</> : <>Start event <Plus size={16}/></>}
        </button>
        {notice && <p className={notice.kind === "ok" ? "voucher-message voucher-ok" : "voucher-message voucher-error"} role="status">
          {notice.kind === "ok" ? <Check size={14}/> : <X size={14}/>}{notice.text}
        </p>}
      </div>
    </section>

    <section className="console-section">
      <div className="section-title-row">
        <div><span className="section-index">02</span><div><h2>All events</h2><p>Including ones that have finished or been stopped.</p></div></div>
        <button className="button button-outline compact-button" type="button" onClick={() => void load()}><RefreshCw size={15}/> Refresh</button>
      </div>

      <div className="model-table-wrap">
        {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading events…</strong></div>}
        {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load events</strong></div>}
        {status === "ready" && events.length === 0 && <div className="table-empty">
          <Layers size={19}/><strong>No events yet</strong><p>Create the first one above.</p>
        </div>}
        {status === "ready" && events.length > 0 && <table className="model-table table-events">
          <thead><tr>
            <th>EVENT</th><th>TYPE</th><th>MODEL</th><th>STATE</th>
            <th>BUDGET</th><th>WINDOW</th><th></th>
          </tr></thead>
          <tbody>{events.map(e => {
            const cap = Number(e.budgetTokens ?? 0);
            const used = Number(e.tokensUsed);
            const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
            const live = e.state === "running";
            return <tr key={e.id}>
              <td>
                <strong>{e.title}</strong>
                <small className="cell-sub"><code>/events/{e.slug}</code></small>
              </td>
              <td><span className="kind-tag">{KINDS.find(k => k.value === e.kind)?.label ?? e.kind}</span></td>
              <td>{e.modelId ? <code className="breakdown-model">{e.modelId}</code> : <span className="cell-none">—</span>}</td>
              <td><span className={
                live ? "outcome-pill outcome-ok"
                  : e.state === "orphaned" ? "outcome-pill outcome-error"
                  : "outcome-pill outcome-interrupted"
              }>{STATE_LABEL[e.state]}</span></td>
              <td className="cell-num">
                {/* No budget means no meter: an empty bar would read as a budget of zero. */}
                {e.budgetTokens === null
                  ? <span className="cell-none">—</span>
                  : <span className={pct >= 100 ? "budget budget-spent" : "budget"}>
                      <span className="budget-bar"><i style={{ width: `${pct}%` }}/></span>
                      <span className="budget-text">{formatTokens(used)} / {formatTokens(cap)}</span>
                    </span>}
              </td>
              <td className="cell-num">
                <span className="event-window">{shortDate(e.startsAt)} → {shortDate(e.endsAt)}</span>
              </td>
              <td>
                <span className="row-actions">
                  {/* Offered on every event that can still serve, not only the live ones: a spent
                      or ended event is exactly the case that needs a top-up, and hiding the button
                      there would leave the dead end this dialog exists to remove. */}
                  {e.kind === "model_budget" && e.state !== "orphaned" && (
                    <button className="row-action" type="button" title="Add budget or extend"
                      aria-label={`Edit ${e.title}`} disabled={busyId === e.id}
                      onClick={() => { setEditing(e); setEditError(""); setEdit({ budgetNumber: "1", budgetMagnitude: "1000000000", extendDays: "7" }); }}>
                      <SlidersHorizontal size={14}/>
                    </button>
                  )}
                  {live && <button className="row-action row-action-danger" type="button" title="Stop event" aria-label={`Stop ${e.title}`} onClick={() => setConfirmStop(e)} disabled={busyId === e.id}>
                    {busyId === e.id ? <Loader2 size={14} className="row-spinner"/> : <Ban size={14}/>}
                  </button>}
                  <button className="row-action row-action-danger" type="button" title="Delete event" aria-label={`Delete ${e.title}`} onClick={() => setConfirmDelete(e)} disabled={busyId === e.id}>
                    {busyId === e.id ? <Loader2 size={14} className="row-spinner"/> : <Trash2 size={14}/>}
                  </button>
                </span>
              </td>
            </tr>;
          })}</tbody>
        </table>}
      </div>
      <div className="table-note"><CalendarClock size={14}/> Events expire on their own clock — no cleanup needed.</div>
    </section>

    <Modal
      open={confirmStop !== null}
      tone="danger"
      title="Stop this event?"
      subtitle={confirmStop ? `/${confirmStop.slug}` : ""}
      onClose={() => setConfirmStop(null)}
      footer={<>
        <button className="button button-outline" type="button" onClick={() => setConfirmStop(null)}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => confirmStop && void stopEvent(confirmStop)} disabled={busyId !== null}>
          {busyId !== null ? <Loader2 size={15} className="row-spinner"/> : <Ban size={15}/>} Stop event
        </button>
      </>}
    >
      {confirmStop && <div className="events-dialog">
        <p><AlertTriangle size={15}/> <span><strong>{confirmStop.title}</strong> will stop serving its budget immediately, and <strong>{confirmStop.modelId}</strong> returns to its normal price.</span></p>
        <div className="modal-danger-note">
          <strong>Nothing is lost</strong>
          <span>It has served <strong>{formatTokens(Number(confirmStop.tokensUsed))}</strong> of {formatTokens(Number(confirmStop.budgetTokens))} tokens. The event stays in this list as <em>Disabled</em> so the spend remains auditable.</span>
        </div>
      </div>}
    </Modal>

    <Modal
      open={editing !== null}
      title="Add budget or extend"
      subtitle={editing ? `/${editing.slug}` : ""}
      onClose={() => { setEditing(null); setEditError(""); }}
      footer={<>
        <button className="button button-outline" type="button" onClick={() => { setEditing(null); setEditError(""); }}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => void saveEdit()} disabled={saving}>
          {saving ? <Loader2 size={15} className="row-spinner"/> : <Check size={15}/>} Save
        </button>
      </>}
    >
      {editing && <div className="events-dialog">
        {editing.state === "exhausted" && <p><Flame size={15}/> <span>This event has spent its whole budget. Adding tokens puts it back to work immediately — the spend so far is kept.</span></p>}
        {editing.state === "ended" && <p><CalendarClock size={15}/> <span>The window has closed. Extending it past today makes the event live again.</span></p>}
        {editing.status === "disabled" && <p><AlertTriangle size={15}/> <span>This event is stopped. Saving will also re-activate it.</span></p>}

        {/* The arithmetic the operator should not have to do: remaining comes from the row, and
            everything below ADDS to it rather than replacing it. */}
        <div className="event-edit-now">
          <span>Spent</span>
          <strong>{formatTokens(Number(editing.tokensUsed))}</strong>
          {editing.budgetTokens && <>
            <span>of</span>
            <strong>{formatTokens(Number(editing.budgetTokens))}</strong>
            <span className="event-edit-left">
              {Number(editing.tokensUsed) >= Number(editing.budgetTokens)
                ? "nothing left"
                : `${formatTokens(Number(editing.budgetTokens) - Number(editing.tokensUsed))} left`}
            </span>
          </>}
        </div>

        {editing.kind === "model_budget" ? <div className="modal-field">
          <label>Add tokens</label>
          <div className="modal-quick">
            <input className="modal-input" inputMode="numeric" value={edit.budgetNumber}
              onChange={e => setEdit(v => ({ ...v, budgetNumber: e.target.value.replace(/[^\d.]/g, "") }))}/>
            <Select value={edit.budgetMagnitude} onChange={v => setEdit(s => ({ ...s, budgetMagnitude: v }))}
              options={MAGNITUDES} label="Budget unit" width={168}/>
          </div>
          <small className="event-edit-hint">
            Added to the current budget. {edit.budgetNumber && Number(edit.budgetNumber) > 0
              ? <>New total {formatTokens(Number(editing.budgetTokens ?? 0) + Math.round(Number(edit.budgetNumber) * Number(edit.budgetMagnitude)))}</>
              : "Leave empty to only extend the window."}
          </small>
        </div> : <p className="event-edit-note"><AlertTriangle size={14}/> An announcement has no token budget — only its window can be extended.</p>}

        <div className="modal-field">
          <label>Extend by</label>
          <Select value={edit.extendDays} onChange={v => setEdit(s => ({ ...s, extendDays: v }))}
            options={DURATIONS.map(d => ({ value: d.value, label: `+${d.label}` }))} label="Extend duration" width={168}/>
          <small className="event-edit-hint">
            Moves the deadline out from where it already is. New end {shortDate(new Date(new Date(editing.endsAt).getTime() + Number(edit.extendDays) * 86_400_000).toISOString())}
          </small>
        </div>

        {editError && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{editError}</p>}
      </div>}
    </Modal>

    <Modal
      open={confirmDelete !== null}
      tone="danger"
      title="Delete this event?"
      subtitle={confirmDelete ? `/${confirmDelete.slug}` : ""}
      onClose={() => setConfirmDelete(null)}
      footer={<>
        <button className="button button-outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
        <button className="button button-ink compact-button" type="button" onClick={() => confirmDelete && void deleteEvent(confirmDelete)} disabled={busyId !== null}>
          {busyId !== null ? <Loader2 size={15} className="row-spinner"/> : <Trash2 size={15}/>} Delete event
        </button>
      </>}
    >
      {confirmDelete && <div className="events-dialog">
        <p><AlertTriangle size={15}/> <span><strong>{confirmDelete.title}</strong> is removed permanently — it disappears from the public page and this list{confirmDelete.modelId ? <>, and <strong>{confirmDelete.modelId}</strong> returns to its normal price</> : ""}.</span></p>
        <div className="modal-danger-note">
          <strong>This cannot be undone</strong>
          <span>{confirmDelete.modelId
            ? <>Prefer <em>Stop</em> if you only want the model back to normal — that keeps the record. Deleting <strong>{formatTokens(Number(confirmDelete.tokensUsed))}</strong> tokens of spend history removes it for good.</>
            : <>The event and its record are removed for good. A stopped event would keep the row; this does not.</>}</span>
        </div>
      </div>}
    </Modal>
  </div>;
}
