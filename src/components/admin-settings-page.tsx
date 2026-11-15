"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { Pencil, Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { Toggle } from "@/components/toggle";
import styles from "./admin-settings.module.css";

type Severity = "warning" | "info";
type Announcement = { id: string; label: string; message: string; active: boolean; severity: Severity; createdAt: string; updatedAt: string };
type Draft = Pick<Announcement, "label" | "message" | "active" | "severity">;
const blank = (): Draft => ({ label: "", message: "", active: true, severity: "warning" });
const endpoint = "/backend/api/v1/admin/announcements";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";

type NotifSeverity = "info" | "warning" | "error";
type NotificationItem = { id: string; title: string; message: string; active: boolean; severity: NotifSeverity; createdAt: string };
type NotifDraft = Pick<NotificationItem, "title" | "message" | "active" | "severity">;
const blankNotif = (): NotifDraft => ({ title: "", message: "", active: true, severity: "info" });
const notifEndpoint = "/backend/api/v1/admin/notifications";

const NOTIF_TEMPLATES: Record<NotifSeverity, { title: string; message: string; btn: string }[]> = {
  info: [
    { btn: "New model", title: "New model available", message: "[model-id] has been added to the catalogue. Check the models page for details." },
    { btn: "Price adjustment", title: "Price update", message: "Pricing for [model-id] has been adjusted. See the models page for the latest rates." },
    { btn: "New payment method", title: "New payment method", message: "[payment-method] is now available. Top up your credits to try it out." },
    { btn: "Free event live", title: "Free event live", message: "A free event for [model-id] is now live. Visit the events page to participate." },
    { btn: "Feature update", title: "Feature update", message: "Devora has been updated with [feature-name]. Check the console for what's new." },
  ],
  warning: [
    { btn: "Payment unavailable", title: "Payment unavailable", message: "[payment-method] is temporarily unavailable. Please use another available method." },
    { btn: "Model unavailable", title: "Model unavailable", message: "[model-id] is temporarily unavailable. We are working on restoring it." },
    { btn: "Slow response", title: "Slow response times", message: "[model-id] may experience slower response times due to upstream load. We appreciate your patience." },
  ],
  error: [
    { btn: "Gateway maintenance", title: "Gateway maintenance", message: "The AI gateway is undergoing scheduled maintenance. Service will be restored by [time]." },
    { btn: "Gateway outage", title: "Gateway outage", message: "The AI gateway is experiencing an outage affecting [model-id]. Our team is investigating." },
    { btn: "Upstream error", title: "Upstream provider error", message: "Upstream provider [provider-name] is returning errors. Requests to [model-id] may fail." },
  ],
};

const TEMPLATES: Record<Severity, { label: string; message: string; btn: string }[]> = {
  warning: [
    { btn: "QRIS · WaroengPay", label: "Service notice", message: "QRIS payments via WaroengPay are temporarily unavailable. Please use another payment method." },
    { btn: "QRIS · Midtrans", label: "Service notice", message: "QRIS payments via Midtrans are temporarily unavailable. Please use another payment method." },
    { btn: "Crypto · CoinPayments", label: "Service notice", message: "Crypto payments are temporarily unavailable. Please use another payment method." },
    { btn: "General maintenance", label: "Service notice", message: "Payment system is under maintenance. Please try again shortly." },
  ],
  info: [
    { btn: "New model", label: "Announcement", message: "A new model has been added to the catalogue. Check the models page for details." },
    { btn: "Free event live", label: "Announcement", message: "A free event is now live. Visit the events page to participate." },
    { btn: "Feature update", label: "Announcement", message: "Devora has been updated. Check the console for what's new." },
    { btn: "Manual top-up", label: "Announcement", message: "Need a manual top-up? Message us on Telegram @dk_zhen2 for assistance." },
  ],
};

function Fields({ value, onChange, disabled = false }: { value: Draft; onChange: (value: Draft) => void; disabled?: boolean }) {
  const templates = TEMPLATES[value.severity] ?? [];
  return <div className={styles.fields}>
    <label className={`admin-field ${styles.field}`}><span>Label</span><input required maxLength={80} value={value.label} disabled={disabled} placeholder="Service notice" onChange={e => onChange({ ...value, label: e.target.value })}/><small>Plain text, up to 80 characters.</small></label>
    <label className={`admin-field ${styles.field}`}><span>Message</span><textarea className="modal-input" required maxLength={2000} rows={4} value={value.message} disabled={disabled} placeholder="What would you like visitors to know?" onChange={e => onChange({ ...value, message: e.target.value })}/><small>Plain text, up to 2,000 characters.</small></label>
    <label className={`admin-field ${styles.field}`}><span>Type</span>
      <div className={styles.severityPicker}>
        <button type="button" className={`${styles.severityBtn} ${value.severity === "warning" ? styles.severityActive : ""}`} disabled={disabled} onClick={() => onChange({ ...value, severity: "warning" })}>
          <span className={`${styles.severityDot} ${styles.dotWarning}`}/> Service notice
        </button>
        <button type="button" className={`${styles.severityBtn} ${value.severity === "info" ? styles.severityActive : ""}`} disabled={disabled} onClick={() => onChange({ ...value, severity: "info" })}>
          <span className={`${styles.severityDot} ${styles.dotInfo}`}/> Announcement
        </button>
      </div>
      <small>Amber dot for service issues, green dot for general announcements.</small>
    </label>
    {templates.length > 0 && <label className={`admin-field ${styles.field}`}><span>Quick templates</span>
      <div className={styles.templateRow}>
        {templates.map(t => <button key={t.btn} type="button" className={styles.templateBtn} disabled={disabled} onClick={() => onChange({ ...value, label: t.label, message: t.message })}>{t.btn}</button>)}
      </div>
      <small>Click to fill the label and message. You can still edit after.</small>
    </label>}
    <Toggle checked={value.active} onChange={active => onChange({ ...value, active })} label="Visible on landing page" disabled={disabled}/>
  </div>;
}

function NotificationFields({ value, onChange, disabled = false }: { value: NotifDraft; onChange: (value: NotifDraft) => void; disabled?: boolean }) {
  const templates = NOTIF_TEMPLATES[value.severity] ?? [];
  return <div className={styles.fields}>
    <label className={`admin-field ${styles.field}`}><span>Title</span><input required maxLength={120} value={value.title} disabled={disabled} placeholder="System maintenance" onChange={e => onChange({ ...value, title: e.target.value })}/><small>Plain text, up to 120 characters.</small></label>
    <label className={`admin-field ${styles.field}`}><span>Message</span><textarea className="modal-input" required maxLength={500} rows={4} value={value.message} disabled={disabled} placeholder="What should users know?" onChange={e => onChange({ ...value, message: e.target.value })}/><small>Plain text, up to 500 characters.</small></label>
    <label className={`admin-field ${styles.field}`}><span>Severity</span>
      <div className={styles.severityPicker}>
        <button type="button" className={`${styles.severityBtn} ${value.severity === "info" ? styles.severityActive : ""}`} disabled={disabled} onClick={() => onChange({ ...value, severity: "info" })}>
          <span className={`${styles.severityDot} ${styles.dotInfo}`}/> Info
        </button>
        <button type="button" className={`${styles.severityBtn} ${value.severity === "warning" ? styles.severityActive : ""}`} disabled={disabled} onClick={() => onChange({ ...value, severity: "warning" })}>
          <span className={`${styles.severityDot} ${styles.dotWarning}`}/> Warning
        </button>
        <button type="button" className={`${styles.severityBtn} ${value.severity === "error" ? styles.severityActive : ""}`} disabled={disabled} onClick={() => onChange({ ...value, severity: "error" })}>
          <span className={`${styles.severityDot} ${styles.dotError}`}/> Error
        </button>
      </div>
      <small>Green for info, amber for warnings, red for errors.</small>
    </label>
    {templates.length > 0 && <label className={`admin-field ${styles.field}`}><span>Quick templates</span>
      <div className={styles.templateRow}>
        {templates.map(t => <button key={t.btn} type="button" className={styles.templateBtn} disabled={disabled} onClick={() => onChange({ ...value, title: t.title, message: t.message })}>{t.btn}</button>)}
      </div>
      <small>Click to fill the title and message. You can still edit after.</small>
    </label>}
    <Toggle checked={value.active} onChange={active => onChange({ ...value, active })} label="Visible to users" disabled={disabled}/>
  </div>;
}

export function AdminSettingsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [listNotice, setListNotice] = useState("");
  const [draft, setDraft] = useState<Draft>(blank);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [edit, setEdit] = useState<Draft>(blank);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const api = useCallback(async (path = "", method = "GET", body?: Draft | Partial<Draft>) => {
    const token = await getToken();
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch(endpoint + path, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "The request failed. Please try again.");
    return data as { announcements: Announcement[]; announcement: Announcement };
  }, [getToken]);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setListError("");
    try { const data = await api(); if (version === requestVersion.current) setRows(data.announcements); }
    catch (error) { if (version === requestVersion.current) setListError(errorText(error)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, [api]);
  useEffect(() => { void refresh(); return () => { requestVersion.current++; }; }, [refresh]);
  const replace = (row: Announcement) => {
    requestVersion.current++; setLoading(false);
    setRows(previous => [row, ...previous.filter(item => item.id !== row.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)));
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true); setCreateError(""); setCreateNotice("");
    try { const data = await api("", "POST", draft); replace(data.announcement); setDraft(blank()); setCreateNotice("Announcement created."); }
    catch (error) { setCreateError(errorText(error)); }
    finally { setCreating(false); }
  };
  const toggle = async (row: Announcement) => {
    setBusy(row.id); setListError(""); setListNotice("");
    try { const data = await api(`/${row.id}`, "PATCH", { active: !row.active }); replace(data.announcement); setListNotice("Visibility updated."); }
    catch (error) { setListError(errorText(error)); }
    finally { setBusy(null); }
  };
  const save = async () => {
    if (!editing) return;
    setBusy(editing.id); setModalError("");
    try { const data = await api(`/${editing.id}`, "PATCH", edit); replace(data.announcement); setEditing(null); setListNotice("Announcement updated."); }
    catch (error) { setModalError(errorText(error)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id); setModalError("");
    try { await api(`/${deleting.id}`, "DELETE"); requestVersion.current++; setLoading(false); setRows(previous => previous.filter(row => row.id !== deleting.id)); setDeleting(null); setListNotice("Announcement deleted."); }
    catch (error) { setModalError(errorText(error)); }
    finally { setBusy(null); }
  };

  // ── Notifications CRUD ────────���─────────────────────────────────────
  const [nRows, setNRows] = useState<NotificationItem[]>([]);
  const [nLoading, setNLoading] = useState(true);
  const [nListError, setNListError] = useState("");
  const [nListNotice, setNListNotice] = useState("");
  const [nDraft, setNDraft] = useState<NotifDraft>(blankNotif);
  const [nCreating, setNCreating] = useState(false);
  const [nCreateError, setNCreateError] = useState("");
  const [nCreateNotice, setNCreateNotice] = useState("");
  const [nEditing, setNEditing] = useState<NotificationItem | null>(null);
  const [nEdit, setNEdit] = useState<NotifDraft>(blankNotif);
  const [nDeleting, setNDeleting] = useState<NotificationItem | null>(null);
  const [nModalError, setNModalError] = useState("");
  const [nBusy, setNBusy] = useState<string | null>(null);
  const nRequestVersion = useRef(0);
  const nApi = useCallback(async (path = "", method = "GET", body?: NotifDraft | Partial<NotifDraft>) => {
    const token = await getToken();
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch(notifEndpoint + path, { method, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "The request failed. Please try again.");
    return data as { notifications: NotificationItem[]; notification: NotificationItem };
  }, [getToken]);
  const nRefresh = useCallback(async () => {
    const version = ++nRequestVersion.current;
    setNLoading(true); setNListError("");
    try { const data = await nApi(); if (version === nRequestVersion.current) setNRows(data.notifications); }
    catch (error) { if (version === nRequestVersion.current) setNListError(errorText(error)); }
    finally { if (version === nRequestVersion.current) setNLoading(false); }
  }, [nApi]);
  useEffect(() => { void nRefresh(); return () => { nRequestVersion.current++; }; }, [nRefresh]);
  const nReplace = (row: NotificationItem) => {
    nRequestVersion.current++; setNLoading(false);
    setNRows(previous => [row, ...previous.filter(item => item.id !== row.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)));
  };
  const nCreate = async (event: FormEvent) => {
    event.preventDefault(); setNCreating(true); setNCreateError(""); setNCreateNotice("");
    try { const data = await nApi("", "POST", nDraft); nReplace(data.notification); setNDraft(blankNotif()); setNCreateNotice("Notification created."); }
    catch (error) { setNCreateError(errorText(error)); }
    finally { setNCreating(false); }
  };
  const nToggle = async (row: NotificationItem) => {
    setNBusy(row.id); setNListError(""); setNListNotice("");
    try { const data = await nApi(`/${row.id}`, "PATCH", { active: !row.active }); nReplace(data.notification); setNListNotice("Visibility updated."); }
    catch (error) { setNListError(errorText(error)); }
    finally { setNBusy(null); }
  };
  const nSave = async () => {
    if (!nEditing) return;
    setNBusy(nEditing.id); setNModalError("");
    try { const data = await nApi(`/${nEditing.id}`, "PATCH", nEdit); nReplace(data.notification); setNEditing(null); setNListNotice("Notification updated."); }
    catch (error) { setNModalError(errorText(error)); }
    finally { setNBusy(null); }
  };
  const nRemove = async () => {
    if (!nDeleting) return;
    setNBusy(nDeleting.id); setNModalError("");
    try { await nApi(`/${nDeleting.id}`, "DELETE"); nRequestVersion.current++; setNLoading(false); setNRows(previous => previous.filter(row => row.id !== nDeleting.id)); setNDeleting(null); setNListNotice("Notification deleted."); }
    catch (error) { setNModalError(errorText(error)); }
    finally { setNBusy(null); }
  };

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><Settings size={14}/> ADMIN / SETTINGS</div><h1>Settings</h1><p>Manage the announcements visitors see on the landing page.</p></div></div>
    <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">01</span><div><h2>Announcements</h2><p>Edit messages and control their visibility.</p></div></div></div>
      <div className={styles.toolbar}><button type="button" className="button button-outline compact-button" disabled={loading || busy !== null || creating} onClick={() => { setListNotice(""); void refresh(); }}><RefreshCw size={14}/> {loading ? "Refreshing…" : "Refresh"}</button></div>
      {listError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{listError}</p>}
      {listNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{listNotice}</p>}
      <div className={`model-table-wrap ${styles.tableWrap}`} aria-busy={loading}><table className={`model-table ${styles.table}`}><thead><tr><th style={{whiteSpace:"nowrap"}}>Label</th><th>Message</th><th style={{whiteSpace:"nowrap"}}>Type</th><th style={{whiteSpace:"nowrap"}}>Visibility</th><th>Actions</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id}><td>{row.label}</td><td className={styles.message}>{row.message}</td><td><span className={`${styles.severityBadge} ${row.severity === "info" ? styles.badgeInfo : styles.badgeWarning}`}><span className={`${styles.severityDot} ${row.severity === "info" ? styles.dotInfo : styles.dotWarning}`}/>{row.severity === "info" ? "Announcement" : "Service notice"}</span></td><td><Toggle checked={row.active} disabled={busy !== null || creating} onChange={() => void toggle(row)} label={row.active ? "Visible" : "Hidden"}/></td><td><div className={styles.actions}><button type="button" className="icon-button" aria-label={`Edit ${row.label}`} disabled={busy !== null} onClick={() => { setEditing(row); setEdit({ label: row.label, message: row.message, active: row.active, severity: row.severity }); setModalError(""); }}><Pencil size={15}/></button><button type="button" className="icon-button" aria-label={`Delete ${row.label}`} disabled={busy !== null} onClick={() => { setDeleting(row); setModalError(""); }}><Trash2 size={15}/></button></div></td></tr>)}
        {!rows.length && <tr><td colSpan={5}>{loading ? "Loading announcements…" : "No announcements yet."}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="console-section"><div className="section-title-row"><div><span className="section-index">02</span><div><h2>Create an announcement</h2><p>A short label and a message, shown together.</p></div></div></div>
      <form className={styles.createForm} onSubmit={event => void create(event)}><Fields value={draft} onChange={setDraft} disabled={creating}/>
        {createError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{createError}</p>}{createNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{createNotice}</p>}
        <div className={styles.submit}><button type="submit" className="button button-ink compact-button" disabled={creating || busy !== null}><Plus size={15}/>{creating ? "Creating…" : "Create announcement"}</button></div>
      </form>
    </section>
    <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">03</span><div><h2>Notifications</h2><p>In-app notifications shown to signed-in console users.</p></div></div></div>
      <div className={styles.toolbar}><button type="button" className="button button-outline compact-button" disabled={nLoading || nBusy !== null || nCreating} onClick={() => { setNListNotice(""); void nRefresh(); }}><RefreshCw size={14}/> {nLoading ? "Refreshing…" : "Refresh"}</button></div>
      {nListError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{nListError}</p>}
      {nListNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{nListNotice}</p>}
      <div className={`model-table-wrap ${styles.tableWrap}`} aria-busy={nLoading}><table className={`model-table ${styles.table}`}><thead><tr><th style={{whiteSpace:"nowrap"}}>Title</th><th>Message</th><th style={{whiteSpace:"nowrap"}}>Severity</th><th style={{whiteSpace:"nowrap"}}>Active</th><th>Actions</th></tr></thead><tbody>
        {nRows.map(row => <tr key={row.id}><td>{row.title}</td><td className={styles.message}>{row.message}</td><td><span className={`${styles.severityBadge} ${row.severity === "info" ? styles.badgeInfo : row.severity === "error" ? styles.badgeError : styles.badgeWarning}`}><span className={`${styles.severityDot} ${row.severity === "info" ? styles.dotInfo : row.severity === "error" ? styles.dotError : styles.dotWarning}`}/>{row.severity === "info" ? "Info" : row.severity === "error" ? "Error" : "Warning"}</span></td><td><Toggle checked={row.active} disabled={nBusy !== null || nCreating} onChange={() => void nToggle(row)} label={row.active ? "Active" : "Inactive"}/></td><td><div className={styles.actions}><button type="button" className="icon-button" aria-label={`Edit ${row.title}`} disabled={nBusy !== null} onClick={() => { setNEditing(row); setNEdit({ title: row.title, message: row.message, active: row.active, severity: row.severity }); setNModalError(""); }}><Pencil size={15}/></button><button type="button" className="icon-button" aria-label={`Delete ${row.title}`} disabled={nBusy !== null} onClick={() => { setNDeleting(row); setNModalError(""); }}><Trash2 size={15}/></button></div></td></tr>)}
        {!nRows.length && <tr><td colSpan={5}>{nLoading ? "Loading notifications…" : "No notifications yet."}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="console-section"><div className="section-title-row"><div><span className="section-index">04</span><div><h2>Create a notification</h2><p>A title and message shown in the console notification bell.</p></div></div></div>
      <form className={styles.createForm} onSubmit={event => void nCreate(event)}><NotificationFields value={nDraft} onChange={setNDraft} disabled={nCreating}/>
        {nCreateError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{nCreateError}</p>}{nCreateNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{nCreateNotice}</p>}
        <div className={styles.submit}><button type="submit" className="button button-ink compact-button" disabled={nCreating || nBusy !== null}><Plus size={15}/>{nCreating ? "Creating…" : "Create notification"}</button></div>
      </form>
    </section>
    <Modal open={nEditing !== null} title="Edit notification" busy={nBusy !== null} onClose={() => setNEditing(null)} footer={<><button type="button" className="button button-outline" disabled={nBusy !== null} onClick={() => setNEditing(null)}>Cancel</button><button type="submit" form="edit-notification" className="button button-ink" disabled={nBusy !== null}>{nBusy ? "Saving…" : "Save changes"}</button></>}>
      <form id="edit-notification" onSubmit={event => { event.preventDefault(); void nSave(); }}><NotificationFields value={nEdit} onChange={setNEdit} disabled={nBusy !== null}/>{nModalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{nModalError}</p>}</form>
    </Modal>
    <Modal open={nDeleting !== null} title="Delete notification?" tone="danger" busy={nBusy !== null} onClose={() => setNDeleting(null)} footer={<><button type="button" className="button button-outline" disabled={nBusy !== null} onClick={() => setNDeleting(null)}>Cancel</button><button type="button" className="button button-ink" disabled={nBusy !== null} onClick={() => void nRemove()}>{nBusy ? "Deleting…" : "Delete notification"}</button></>}>
      <p>Delete <strong>{nDeleting?.title}</strong>? It will be removed from all users. This cannot be undone.</p>{nModalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{nModalError}</p>}
    </Modal>
    <Modal open={editing !== null} title="Edit announcement" busy={busy !== null} onClose={() => setEditing(null)} footer={<><button type="button" className="button button-outline" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="edit-announcement" className="button button-ink" disabled={busy !== null}>{busy ? "Saving…" : "Save changes"}</button></>}>
      <form id="edit-announcement" onSubmit={event => { event.preventDefault(); void save(); }}><Fields value={edit} onChange={setEdit} disabled={busy !== null}/>{modalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{modalError}</p>}</form>
    </Modal>
    <Modal open={deleting !== null} title="Delete announcement?" tone="danger" busy={busy !== null} onClose={() => setDeleting(null)} footer={<><button type="button" className="button button-outline" disabled={busy !== null} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="button button-ink" disabled={busy !== null} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete announcement"}</button></>}>
      <p>Delete <strong>{deleting?.label}</strong>? It will be removed from the landing page. This cannot be undone.</p>{modalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{modalError}</p>}
    </Modal>
  </div>;
}
