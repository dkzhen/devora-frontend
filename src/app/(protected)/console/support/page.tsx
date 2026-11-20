"use client";

import { useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { AlertTriangle, Check, Headset, Loader2, Send } from "lucide-react";

type Category = "bug" | "feature" | "billing" | "account" | "stock" | "other";

const CATEGORIES: { value: Category; label: string; template: string }[] = [
  { value: "bug", label: "Bug report", template: "What happened:\n\nSteps to reproduce:\n1.\n2.\n3.\n\nExpected:\n\nActual:" },
  { value: "feature", label: "Feature request", template: "Feature:\n\nWhy I need it:\n\nHow it would work:" },
  { value: "billing", label: "Billing question", template: "Issue:\n\nOrder ID:\n\nAmount paid:" },
  { value: "account", label: "Account issue", template: "Problem:\n\nEmail:\n\nError message:" },
  { value: "stock", label: "Package stock", template: "Package name:\n\nQuestion: Is this package still available? How many slots are left?" },
  { value: "other", label: "Other", template: "Message:" },
];

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

  const activeCategory = CATEGORIES.find(c => c.value === category) ?? CATEGORIES[0];

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
    </div>
  );
}
