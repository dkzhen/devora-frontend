"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertTriangle, Check, Headset, Loader2, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import { Select } from "@/components/select";
import { Modal } from "@/components/modal";

/**
 * Operator inbox.
 *
 * Every ticket from every account, with the conversation attached and a reply box per
 * thread. A reply is addressed by the ticket, not by anything typed here: the server
 * derives the recipient from the ticket's `user_id`, so an answer cannot be delivered to
 * an account that did not open it. The response echoes `recipientEmail`, and this page
 * shows it after sending — a mis-targeted reply would be visible immediately instead of
 * being discovered by the wrong customer.
 */

type Reply = {
  id: string;
  author: "user" | "admin";
  authorEmail: string | null;
  message: string;
  read: boolean;
  createdAt: string;
};

type Ticket = {
  id: string;
  ticketNo: number;
  ticketId: string;
  userId: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  status: "open" | "replied" | "resolved" | "closed";
  telegramSent: boolean;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
};

type Counts = { open: number; replied: number; resolved: number; closed: number };

const STATUS_CLASS: Record<Ticket["status"], string> = {
  open: "status-pending",
  replied: "status-active",
  resolved: "status-completed",
  closed: "status-expired",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "replied", label: "Replied" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

/** Statuses an operator can move a ticket to without writing an answer. */
const SET_STATUS_OPTIONS = STATUS_OPTIONS.slice(1);

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function AdminSupportPage() {
  const { getToken } = useAuth();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Counts>({ open: 0, replied: 0, resolved: 0, closed: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<{ ticketId: string; email: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Deletion. Spam arrives open, so a single delete is offered on any status; the bulk
   *  action is limited to closed threads, which is the routine cleanup path. */
  const [confirmDelete, setConfirmDelete] = useState<Ticket | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/backend/api/v1/admin/support?${params.toString()}`, {
        headers: await authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { tickets?: Ticket[]; counts?: Counts };
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      if (data.counts) setCounts(data.counts);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [authHeaders, statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const reply = async (ticket: Ticket) => {
    const draft = (drafts[ticket.id] ?? "").trim();
    if (!draft) return;
    setSendingTo(ticket.id);
    setActionError(null);
    try {
      const res = await fetch(`/backend/api/v1/admin/support/${ticket.id}/reply`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ message: draft }),
      });
      if (!res.ok) {
        setActionError(`Could not send the reply to ${ticket.ticketId}.`);
        return;
      }
      const data = await res.json() as { recipientEmail?: string };
      setDrafts(prev => ({ ...prev, [ticket.id]: "" }));
      setDelivered({ ticketId: ticket.ticketId, email: data.recipientEmail ?? ticket.email });
      await load();
    } catch {
      setActionError(`Could not send the reply to ${ticket.ticketId}.`);
    } finally {
      setSendingTo(null);
    }
  };

  const setTicketStatus = async (ticket: Ticket, next: string) => {
    if (!next || next === ticket.status) return;
    setActionError(null);
    try {
      const res = await fetch(`/backend/api/v1/admin/support/${ticket.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) { setActionError(`Could not update ${ticket.ticketId}.`); return; }
      await load();
    } catch {
      setActionError(`Could not update ${ticket.ticketId}.`);
    }
  };

  const deleteTicket = async (ticket: Ticket) => {
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(`/backend/api/v1/admin/support/${ticket.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) { setActionError(`Could not delete ${ticket.ticketId}.`); return; }
      setConfirmDelete(null);
      setDeleteNotice(`${ticket.ticketId} deleted with its conversation.`);
      await load();
    } catch {
      setActionError(`Could not delete ${ticket.ticketId}.`);
    } finally {
      setDeleting(false);
    }
  };

  const purgeClosed = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch("/backend/api/v1/admin/support/purge-closed", {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) { setActionError("Could not delete the closed tickets."); return; }
      const data = await res.json() as { deleted?: number };
      setConfirmPurge(false);
      setDeleteNotice(`${data.deleted ?? 0} closed ticket(s) deleted.`);
      await load();
    } catch {
      setActionError("Could not delete the closed tickets.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow small-eyebrow"><Headset size={14}/> ADMIN</div>
          <h1>Support</h1>
          <p>Every ticket from every account, with the conversation and a reply box.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {counts.closed > 0 && (
            <button
              className="button button-outline compact-button"
              type="button"
              onClick={() => { setDeleteNotice(null); setConfirmPurge(true); }}
              style={{ borderColor: "#b32320", color: "#b32320" }}
            >
              <Trash2 size={14}/> Delete closed ({counts.closed})
            </button>
          )}
          <button
            className="button button-outline compact-button"
            type="button"
            onClick={() => void load()}
            disabled={status === "loading"}
          >
            <RefreshCw size={14} className={status === "loading" ? "row-spinner" : undefined}/> Refresh
          </button>
        </div>
      </div>

      {deleteNotice && (
        <p className="voucher-message voucher-ok" role="status">
          <Check size={14}/> {deleteNotice}
        </p>
      )}

      {delivered && (
        <p className="voucher-message voucher-ok" role="status">
          <Check size={14}/> Reply on {delivered.ticketId} delivered to <strong>{delivered.email}</strong>.
        </p>
      )}
      {actionError && (
        <p className="voucher-message voucher-error" role="status">
          <AlertTriangle size={14}/> {actionError}
        </p>
      )}

      <section className="console-section">
        <div className="section-title-row">
          <div>
            <span className="section-index">00</span>
            <div><h2>Inbox</h2><p>Newest activity first.</p></div>
          </div>
        </div>

        <div className="support-inbox-toolbar">
          <div className="support-counts">
            {(["open", "replied", "resolved", "closed"] as const).map(k => (
              <button
                key={k}
                type="button"
                className={statusFilter === k ? "support-count support-count-on" : "support-count"}
                onClick={() => setStatusFilter(statusFilter === k ? "" : k)}
              >
                <b>{counts[k]}</b>
                <span>{k}</span>
              </button>
            ))}
          </div>

          <div className="support-inbox-filters">
            <div className="search-field">
              <Search size={14}/>
              <input
                type="search"
                value={searchInput}
                placeholder="Search email, subject, #ticket"
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") setSearch(searchInput); }}
              />
            </div>
            <button className="button button-outline compact-button" type="button" onClick={() => setSearch(searchInput)}>
              Search
            </button>
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
              label="Filter by status"
              width={170}
            />
          </div>
        </div>

        {status === "error" && (
          <p className="voucher-message voucher-error" role="status">
            <AlertTriangle size={14}/> Could not load the inbox.
          </p>
        )}

        {status === "loading" && tickets.length === 0 && (
          <p className="row-state" style={{ marginTop: 14 }}>
            <Loader2 size={14} className="row-spinner"/> Loading tickets…
          </p>
        )}

        {status === "ready" && tickets.length === 0 && (
          <div className="table-empty">
            <Headset size={20}/>
            <strong>No tickets</strong>
            <p>Nothing matches this filter. Support requests from accounts appear here.</p>
          </div>
        )}

        <div className="support-thread-list">
          {tickets.map(t => {
            const unread = t.replies.filter(r => r.author === "admin" && !r.read).length;
            return (
              <article key={t.id} className="support-ticket">
                <header className="support-ticket-head">
                  <span className="support-ticket-no">{t.ticketId}</span>
                  <div className="support-ticket-title">
                    <strong>{t.subject}</strong>
                    <small>
                      <span className="support-ticket-email">{t.email}</span> · {t.category} · {shortDate(t.createdAt)}
                      {unread > 0 && <span className="support-unread">{unread} unread</span>}
                    </small>
                  </div>
                  <span className={`status-pill ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                  <button
                    className="row-action row-action-danger"
                    type="button"
                    title={`Delete ${t.ticketId}`}
                    onClick={() => { setDeleteNotice(null); setConfirmDelete(t); }}
                  >
                    <Trash2 size={14}/>
                  </button>
                </header>

                <div className="support-msgs">
                  <div className="support-msg support-msg-user">
                    <div className="support-msg-head">
                      <span>{t.email}</span>
                      <time>{shortDate(t.createdAt)}</time>
                    </div>
                    <p>{t.message}</p>
                  </div>

                  {t.replies.map(r => (
                    <div key={r.id} className={`support-msg support-msg-${r.author}`}>
                      <div className="support-msg-head">
                        <span>{r.author === "admin" ? `Devora (${r.authorEmail ?? "operator"})` : t.email}</span>
                        <time>{shortDate(r.createdAt)}</time>
                      </div>
                      <p>{r.message}</p>
                    </div>
                  ))}
                </div>

                <div className="support-composer">
                  <textarea
                    className="modal-input"
                    value={drafts[t.id] ?? ""}
                    onChange={e => setDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                    placeholder={`Reply to ${t.email}…`}
                    maxLength={4000}
                    rows={3}
                  />
                  <div className="support-composer-actions">
                    <Select
                      value={t.status}
                      options={SET_STATUS_OPTIONS}
                      onChange={next => void setTicketStatus(t, next)}
                      label={`Status for ticket ${t.ticketId}`}
                      width={150}
                    />
                    <button
                      className="button button-ink compact-button"
                      type="button"
                      onClick={() => void reply(t)}
                      disabled={sendingTo === t.id || !(drafts[t.id] ?? "").trim()}
                    >
                      {sendingTo === t.id
                        ? <><Loader2 size={14} className="row-spinner"/> Sending…</>
                        : <><Send size={14}/> Send reply</>}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <Modal
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.ticketId ?? "ticket"}?`}
        subtitle={confirmDelete ? `From ${confirmDelete.email} — the ticket and its whole conversation are removed from the database.` : undefined}
        onClose={() => { if (!deleting) setConfirmDelete(null); }}
        busy={deleting}
        tone="danger"
        footer={
          <>
            <button className="button button-outline" type="button" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </button>
            <button
              className="button button-ink"
              type="button"
              onClick={() => { if (confirmDelete) void deleteTicket(confirmDelete); }}
              disabled={deleting}
              style={{ borderColor: "#b32320", background: "#b32320", color: "#fff" }}
            >
              {deleting ? <><Loader2 size={14} className="row-spinner"/> Deleting…</> : <><Trash2 size={14}/> Delete ticket</>}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--muted-foreground)" }}>
          This cannot be undone. Use it for spam or threads that should not exist — a finished
          conversation is better left <strong>closed</strong> so the history stays.
        </p>
      </Modal>

      <Modal
        open={confirmPurge}
        title={`Delete ${counts.closed} closed ticket${counts.closed === 1 ? "" : "s"}?`}
        subtitle="Every ticket with status closed is removed, with its conversation."
        onClose={() => { if (!deleting) setConfirmPurge(false); }}
        busy={deleting}
        tone="danger"
        footer={
          <>
            <button className="button button-outline" type="button" onClick={() => setConfirmPurge(false)} disabled={deleting}>
              Cancel
            </button>
            <button
              className="button button-ink"
              type="button"
              onClick={() => void purgeClosed()}
              disabled={deleting}
              style={{ borderColor: "#b32320", background: "#b32320", color: "#fff" }}
            >
              {deleting ? <><Loader2 size={14} className="row-spinner"/> Deleting…</> : <><Trash2 size={14}/> Delete closed</>}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--muted-foreground)" }}>
          Open, replied, and resolved threads are untouched. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
