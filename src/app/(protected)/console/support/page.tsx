"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { AlertTriangle, Check, Headset, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";

type Category = "bug" | "feature" | "billing" | "account" | "stock" | "other";

const CATEGORIES: { value: Category; label: string; template: string }[] = [
  { value: "bug", label: "Bug report", template: "What happened:\n\nSteps to reproduce:\n1.\n2.\n3.\n\nExpected:\n\nActual:" },
  { value: "feature", label: "Feature request", template: "Feature:\n\nWhy I need it:\n\nHow it would work:" },
  { value: "billing", label: "Billing question", template: "Issue:\n\nOrder ID:\n\nAmount paid:" },
  { value: "account", label: "Account issue", template: "Problem:\n\nEmail:\n\nError message:" },
  { value: "stock", label: "Package stock", template: "Package name:\n\nQuestion: Is this package still available? How many slots are left?" },
  { value: "other", label: "Other", template: "Message:" },
];

/** One message in a thread: a customer follow-up or an operator answer. */
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
  category: string;
  subject: string;
  message: string;
  status: "open" | "replied" | "resolved" | "closed";
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
};

/** Status text mapped onto the pills the rest of the console already uses. */
const STATUS_CLASS: Record<Ticket["status"], string> = {
  open: "status-pending",
  replied: "status-active",
  resolved: "status-completed",
  closed: "status-expired",
};

/** "Nov 26, 09:47" — short enough for a thread header. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function SupportPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const [category, setCategory] = useState<Category>("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [ticketId, setTicketId] = useState<string | null>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threadsError, setThreadsError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const activeCategory = CATEGORIES.find(c => c.value === category) ?? CATEGORIES[0];

  const loadThreads = useCallback(async () => {
    setThreadsError(false);
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/support/mine", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
        cache: "no-store",
      });
      if (!res.ok) { setThreadsError(true); return; }
      const data = await res.json() as { tickets: Ticket[] };
      const list = data.tickets ?? [];
      setTickets(list);

      // Clear the unread marker on the operator answers this load revealed. Best effort:
      // failing to mark it read must not hide the thread the user came to read.
      for (const t of list) {
        if (t.replies.some(r => r.author === "admin" && !r.read)) {
          void fetch(`/backend/api/v1/support/${t.id}/read`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token ?? ""}` },
          }).catch(() => {});
        }
      }
    } catch {
      setThreadsError(true);
    } finally {
      setLoadingThreads(false);
    }
  }, [getToken]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const sendReply = async (ticket: Ticket) => {
    const draft = (drafts[ticket.id] ?? "").trim();
    if (!draft) return;
    setReplyingTo(ticket.id);
    try {
      const token = await getToken();
      const res = await fetch(`/backend/api/v1/support/${ticket.id}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: draft }),
      });
      if (!res.ok) return;
      setDrafts(prev => ({ ...prev, [ticket.id]: "" }));
      await loadThreads();
    } catch {
      /* the draft stays in the box so the text is not lost */
    } finally {
      setReplyingTo(null);
    }
  };

  const pickCategory = (c: Category) => {
    setCategory(c);
    const tmpl = CATEGORIES.find(x => x.value === c);
    if (tmpl) setMessage(tmpl.template);
  };

type SubmitResult = { ok: boolean; ticketId?: string };

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    setStatus("idle");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/support", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          message: message.trim(),
          email,
        }),
      });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as SubmitResult;
      setTicketId(data.ticketId ?? null);
      setStatus("ok");
      setSubject("");
      setMessage("");
      setCategory("bug");
      // The new ticket belongs in the conversation card straight away.
      await loadThreads();
    } catch {
      setStatus("error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <div className="eyebrow small-eyebrow"><Headset size={14}/> ACCOUNTS</div>
          <h1>Support</h1>
          <p>Send a bug report, feature request, or feedback to the team.</p>
        </div>
      </div>

      {status === "ok" && (
        <p className="voucher-message voucher-ok" role="status">
          <Check size={14}/> Ticket {ticketId ?? ""} created. We&apos;ll get back to you at <strong>{email}</strong>.
        </p>
      )}
      {status === "error" && (
        <p className="voucher-message voucher-error" role="status">
          <AlertTriangle size={14}/> Could not send your message. Please try again.
        </p>
      )}

      <section className="console-section">
        <div className="section-title-row">
          <div>
            <span className="section-index">00</span>
            <div><h2>New ticket</h2><p>Tell us what&apos;s going on.</p></div>
          </div>
        </div>

        <div className="support-form" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560, marginTop: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 6 }}>
              Category
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  className={category === c.value ? "plan-pill plan-pill-on" : "plan-pill"}
                  onClick={() => pickCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 6 }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Brief summary of the issue"
              className="modal-input"
              style={{ width: "100%", padding: "10px 14px" }}
              maxLength={120}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "var(--fs-micro)", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 6 }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe your issue…"
              className="modal-input"
              style={{ width: "100%", padding: "10px 14px", minHeight: 160, resize: "vertical", fontFamily: "var(--body)" }}
              maxLength={4000}
            />
            <small style={{ color: "var(--muted-foreground)", fontSize: "var(--fs-micro)" }}>
              {message.length} / 4000 characters
            </small>
          </div>

          <div>
            <button
              className="button button-ink"
              type="button"
              onClick={() => void submit()}
              disabled={sending || !subject.trim() || !message.trim()}
              style={{ minHeight: 44, padding: "0 28px" }}
            >
              {sending
                ? <><Loader2 size={16} className="row-spinner"/> Sending…</>
                : <><Send size={16}/> Send message</>}
            </button>
          </div>
        </div>
      </section>

      {(loadingThreads || tickets.length > 0 || threadsError) && (
        <section className="console-section">
          <div className="section-title-row">
            <div>
              <span className="section-index">01</span>
              <div>
                <h2>Conversations</h2>
                <p>Every ticket you have opened, and our answers.</p>
              </div>
            </div>
            <button
              className="button button-outline compact-button"
              type="button"
              onClick={() => void loadThreads()}
              disabled={loadingThreads}
            >
              <RefreshCw size={14} className={loadingThreads ? "row-spinner" : undefined}/> Refresh
            </button>
          </div>

          {threadsError && !loadingThreads && (
            <p className="voucher-message voucher-error" role="status">
              <AlertTriangle size={14}/> Could not load your conversations.
            </p>
          )}

          {loadingThreads && tickets.length === 0 && (
            <p className="row-state" style={{ marginTop: 14 }}>
              <Loader2 size={14} className="row-spinner"/> Loading conversations…
            </p>
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
                        {t.category} · opened {shortDate(t.createdAt)}
                        {unread > 0 && <span className="support-unread">{unread} new</span>}
                      </small>
                    </div>
                    <span className={`status-pill ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                  </header>

                  <div className="support-msgs">
                    <div className="support-msg support-msg-user">
                      <div className="support-msg-head">
                        <span>You</span>
                        <time>{shortDate(t.createdAt)}</time>
                      </div>
                      <p>{t.message}</p>
                    </div>

                    {t.replies.map(r => (
                      <div key={r.id} className={`support-msg support-msg-${r.author}`}>
                        <div className="support-msg-head">
                          <span>{r.author === "admin" ? "Devora support" : "You"}</span>
                          <time>{shortDate(r.createdAt)}</time>
                        </div>
                        <p>{r.message}</p>
                      </div>
                    ))}
                  </div>

                  {t.status !== "closed" && (
                    <div className="support-composer">
                      <textarea
                        className="modal-input"
                        value={drafts[t.id] ?? ""}
                        onChange={e => setDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder="Add a message to this ticket…"
                        maxLength={4000}
                        rows={2}
                      />
                      <button
                        className="button button-ink compact-button"
                        type="button"
                        onClick={() => void sendReply(t)}
                        disabled={replyingTo === t.id || !(drafts[t.id] ?? "").trim()}
                      >
                        {replyingTo === t.id
                          ? <><Loader2 size={14} className="row-spinner"/> Sending…</>
                          : <><MessageSquare size={14}/> Reply</>}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
