"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { Pencil, Plus, RefreshCw, Settings, Trash2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { Toggle } from "@/components/toggle";
import styles from "./admin-settings.module.css";

type Announcement = { id: string; label: string; message: string; active: boolean; createdAt: string; updatedAt: string };
type Draft = Pick<Announcement, "label" | "message" | "active">;
const blank = (): Draft => ({ label: "", message: "", active: true });
const endpoint = "/backend/api/v1/admin/announcements";
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";

function Fields({ value, onChange, disabled = false }: { value: Draft; onChange: (value: Draft) => void; disabled?: boolean }) {
  return <div className={styles.fields}>
    <label className={`admin-field ${styles.field}`}><span>Label</span><input required maxLength={80} value={value.label} disabled={disabled} placeholder="Service notice" onChange={e => onChange({ ...value, label: e.target.value })}/><small>Plain text, up to 80 characters.</small></label>
    <label className={`admin-field ${styles.field}`}><span>Message</span><textarea className="modal-input" required maxLength={2000} rows={4} value={value.message} disabled={disabled} placeholder="What would you like visitors to know?" onChange={e => onChange({ ...value, message: e.target.value })}/><small>Plain text, up to 2,000 characters.</small></label>
    <Toggle checked={value.active} onChange={active => onChange({ ...value, active })} label="Visible on landing page" disabled={disabled}/>
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
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><Settings size={14}/> ADMIN / SETTINGS</div><h1>Settings</h1><p>Manage the announcements visitors see on the landing page.</p></div></div>
    <section className="console-section">
      <div className="section-title-row"><div><span className="section-index">01</span><div><h2>Announcements</h2><p>Edit messages and control their visibility.</p></div></div></div>
      <div className={styles.toolbar}><button type="button" className="button button-outline compact-button" disabled={loading || busy !== null || creating} onClick={() => { setListNotice(""); void refresh(); }}><RefreshCw size={14}/> {loading ? "Refreshing…" : "Refresh"}</button></div>
      {listError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{listError}</p>}
      {listNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{listNotice}</p>}
      <div className={`model-table-wrap ${styles.tableWrap}`} aria-busy={loading}><table className={`model-table ${styles.table}`}><thead><tr><th>Label</th><th>Message</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.id}><td>{row.label}</td><td className={styles.message}>{row.message}</td><td><Toggle checked={row.active} disabled={busy !== null || creating} onChange={() => void toggle(row)} label={row.active ? "Visible" : "Hidden"}/></td><td><div className={styles.actions}><button type="button" className="icon-button" aria-label={`Edit ${row.label}`} disabled={busy !== null} onClick={() => { setEditing(row); setEdit({ label: row.label, message: row.message, active: row.active }); setModalError(""); }}><Pencil size={15}/></button><button type="button" className="icon-button" aria-label={`Delete ${row.label}`} disabled={busy !== null} onClick={() => { setDeleting(row); setModalError(""); }}><Trash2 size={15}/></button></div></td></tr>)}
        {!rows.length && <tr><td colSpan={4}>{loading ? "Loading announcements…" : "No announcements yet."}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="console-section"><div className="section-title-row"><div><span className="section-index">02</span><div><h2>Create an announcement</h2><p>A short label and a message, shown together.</p></div></div></div>
      <form className={styles.createForm} onSubmit={event => void create(event)}><Fields value={draft} onChange={setDraft} disabled={creating}/>
        {createError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{createError}</p>}{createNotice && <p role="status" className={`voucher-message voucher-ok ${styles.feedback}`}>{createNotice}</p>}
        <div className={styles.submit}><button type="submit" className="button button-ink compact-button" disabled={creating || busy !== null}><Plus size={15}/>{creating ? "Creating…" : "Create announcement"}</button></div>
      </form>
    </section>
    <Modal open={editing !== null} title="Edit announcement" busy={busy !== null} onClose={() => setEditing(null)} footer={<><button type="button" className="button button-outline" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</button><button type="submit" form="edit-announcement" className="button button-ink" disabled={busy !== null}>{busy ? "Saving…" : "Save changes"}</button></>}>
      <form id="edit-announcement" onSubmit={event => { event.preventDefault(); void save(); }}><Fields value={edit} onChange={setEdit} disabled={busy !== null}/>{modalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{modalError}</p>}</form>
    </Modal>
    <Modal open={deleting !== null} title="Delete announcement?" tone="danger" busy={busy !== null} onClose={() => setDeleting(null)} footer={<><button type="button" className="button button-outline" disabled={busy !== null} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="button button-ink" disabled={busy !== null} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete announcement"}</button></>}>
      <p>Delete <strong>{deleting?.label}</strong>? It will be removed from the landing page. This cannot be undone.</p>{modalError && <p role="alert" className={`voucher-message voucher-error ${styles.feedback}`}>{modalError}</p>}
    </Modal>
  </div>;
}
