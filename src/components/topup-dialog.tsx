"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import QRCode from "qrcode";
import {
  AlertTriangle, Check, Clock, Coins, Copy, Loader2, RefreshCw, QrCode, X,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { formatCredits, formatRupiah } from "@/lib/credits";

/**
 * Top up credits over QRIS.
 *
 * The price is never sent from here — the client asks for CREDITS and the backend prices them
 * from the stored rate. The response carries the QR string, the amount and the fee.
 *
 * Status comes from polling `GET /api/v1/topups/:orderId`, which asks the gateway directly and
 * settles on the same path the webhook uses. That is deliberate: the backend binds to localhost
 * in dev, so no webhook can reach it, and the two paths must not be able to disagree.
 */
type Topup = {
  orderId: string;
  status: "pending" | "completed" | "canceled";
  credits: string;
  amountIdr: number;
  feeIdr: number;
  totalIdr: number;
  paymentMethod: string;
  qrString: string | null;
  vaNumber: string | null;
  expiresAt: string | null;
  isSandbox: boolean;
};

/** A handful of sensible sizes. The field takes any whole number of credits. */
const PRESETS = [10_000, 25_000, 50_000, 100_000];

/** The gateway rate-limits status reads to one per 4 seconds, so polling faster only 429s. */
const POLL_MS = 4_000;

/**
 * Render a QR string to a canvas.
 *
 * The QR is generated in the browser rather than by a third-party image service: the payload is
 * a payment string, and sending it to someone else's server to have a picture drawn would hand
 * them every order.
 */
function QrCanvas({ value, size = 232 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    }).catch(() => { /* the raw string is shown below the code as the fallback */ });
  }, [value, size]);

  return <canvas ref={ref} width={size} height={size} aria-label="QRIS payment code" role="img" />;
}

function Countdown({ expiresAt }: { expiresAt: string | null }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) { setLeft(null); return; }
    const tick = () => setLeft(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  if (left === null) return null;
  if (left <= 0) return <span className="topup-expiry topup-expiry-out"><Clock size={13}/> Expired — start a new one.</span>;

  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return <span className="topup-expiry">
    <Clock size={13}/> Expires in {mins}:{String(secs).padStart(2, "0")}
  </span>;
}

export function TopupDialog({
  open, onClose, onSettled, balance,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once a payment settles, so the page can refresh the balance. */
  onSettled: () => void;
  balance: string;
}) {
  const { getToken } = useAuth();
  const [credits, setCredits] = useState("25000");
  const [topup, setTopup] = useState<Topup | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  /**
   * Derived from the order's own status, not from a flag set inside the poll.
   *
   * A separate `settled` flag only flipped on the poll's transition, so an order that arrived
   * already completed — a resumed page, or a create response that raced a fast settlement —
   * showed the QR and a "waiting for payment" line for something already paid.
   */
  const settled = topup?.status === "completed";

  const authHeaders = useCallback(async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token ?? ""}`, "content-type": "application/json" };
  }, [getToken]);

  // Reset whenever the dialog is reopened, so a stale QR from a previous visit never shows.
  useEffect(() => {
    if (!open) return;
    setTopup(null);
    setError("");
    setCopied(false);
  }, [open]);

  const create = async () => {
    setError("");
    const n = Number(credits);
    if (!Number.isFinite(n) || n < 1) { setError("Enter how many credits you want."); return; }
    setCreating(true);
    try {
      const res = await fetch("/backend/api/v1/topups", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ credits: Math.round(n) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not create the top-up.");
        return;
      }
      const data = await res.json() as { topup?: Topup };
      if (!data.topup) { setError("The gateway returned an unusable response."); return; }
      setTopup(data.topup);
      // An order that comes back already completed (a fast settlement) never enters the poll,
      // so the balance refresh has to be triggered here too.
      if (data.topup.status === "completed") onSettled();
    } catch {
      setError("Could not reach the gateway.");
    } finally { setCreating(false); }
  };

  // Poll while an order is open and still pending. Stops the moment it settles or is canceled,
  // and the interval is cleared on unmount, so a closed dialog leaves no timer behind.
  useEffect(() => {
    if (!open || topup === null || topup.status !== "pending") return;
    let cancelled = false;

    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/backend/api/v1/topups/${encodeURIComponent(topup.orderId)}`, {
            headers: await authHeaders(), cache: "no-store",
          });
          if (!res.ok) return;
          const data = await res.json() as { topup?: Topup };
          if (cancelled || !data.topup) return;
          setTopup(prev => (prev === null ? data.topup! : { ...prev, ...data.topup! }));
          // `settled` is derived from the status, so nothing to flip here — only the page needs
          // telling that the balance moved.
          if (data.topup.status === "completed") onSettled();
        } catch { /* a poll failure is not worth surfacing — the next tick retries */ }
      })();
    }, POLL_MS);

    return () => { cancelled = true; window.clearInterval(id); };
  }, [open, topup, authHeaders, onSettled]);

  const copyString = async () => {
    if (!topup?.qrString) return;
    try {
      await navigator.clipboard.writeText(topup.qrString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable over plain HTTP on a LAN address — the same restriction the
      // console hit before. Selecting the text by hand is the fallback, so say so rather than
      // pretending it copied.
      setError("Clipboard is blocked on this connection — select the text and copy it manually.");
    }
  };

  const fee = topup?.feeIdr ?? 0;
  const buyerPaysFee = topup !== null && topup.totalIdr > topup.amountIdr;

  return <Modal
    open={open}
    onClose={onClose}
    title={settled ? "Credits added" : "Add credits"}
    subtitle={settled
      ? "The payment settled and your balance is updated."
      : "Pay with any QRIS app — GoPay, OVO, DANA, ShopeePay, or your bank."}
    busy={creating}
    footer={settled
      ? <button className="button button-ink compact-button" type="button" onClick={onClose}>
          <Check size={15}/> Done
        </button>
      : topup === null
        ? <>
            <button className="button button-outline" type="button" onClick={onClose} disabled={creating}>Cancel</button>
            <button className="button button-ink compact-button" type="button" onClick={() => void create()} disabled={creating}>
              {creating ? <><Loader2 size={15} className="row-spinner"/> Creating…</> : <>Show QR code <QrCode size={15}/></>}
            </button>
          </>
        : <>
            <button className="button button-outline" type="button" onClick={onClose}>Close</button>
            <button className="button button-ink compact-button" type="button" onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2 size={15} className="row-spinner"/> : <RefreshCw size={15}/>} New code
            </button>
          </>}
  >
    {error && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{error}</p>}

    {settled && topup && <div className="topup-settled">
      <span className="topup-settled-mark"><Check size={26}/></span>
      <div className="topup-settled-copy">
        <strong>+{formatCredits(topup.credits)} credits</strong>
        <small>Paid {formatRupiah(topup.totalIdr)} · order <code>{topup.orderId}</code></small>
      </div>
    </div>}

    {!settled && topup === null && <>
      <div className="admin-subfield topup-amount">
        <span className="admin-subfield-label">How many credits</span>
        <p className="admin-subfield-hint">
          One credit is one rupiah at the current rate. Your balance is {formatCredits(balance)}.
        </p>
        <div className="topup-presets">
          {PRESETS.map(p => <button key={p} type="button"
            className={Number(credits) === p ? "plan-pill plan-pill-on" : "plan-pill"}
            aria-pressed={Number(credits) === p}
            onClick={() => setCredits(String(p))}>
            {formatCredits(String(p))}
          </button>)}
        </div>
        <label className="admin-field">
          <span>Credits</span>
          <input value={credits} inputMode="numeric" placeholder="25000"
            onChange={e => setCredits(e.target.value)} />
        </label>
        {/* Raw digits above, the reading below — the same rule the admin forms follow. */}
        <p className="admin-scale-note" aria-live="polite">
          {Number(credits) >= 1
            ? <><strong>{formatRupiah(Math.round(Number(credits)))}</strong> plus the QRIS fee, paid by you</>
            : <><strong>—</strong> Enter a whole number of credits.</>}
        </p>
      </div>
    </>}

    {!settled && topup !== null && <>
      <div className="topup-pay">
        <div className="topup-qr">
          {topup.qrString
            ? <QrCanvas value={topup.qrString}/>
            : <div className="table-empty"><QrCode size={22}/><strong>No QR returned</strong></div>}
        </div>
        <div className="topup-facts">
          <div className="topup-fact">
            <small>YOU PAY</small>
            <strong>{formatRupiah(topup.totalIdr)}</strong>
          </div>
          <div className="topup-fact">
            <small>YOU GET</small>
            <strong>{formatCredits(topup.credits)} <span>credits</span></strong>
          </div>
          {buyerPaysFee && <div className="topup-fact topup-fact-sub">
            <small>BREAKDOWN</small>
            <strong>{formatRupiah(topup.amountIdr)} + {formatRupiah(fee)} fee</strong>
          </div>}
          <Countdown expiresAt={topup.expiresAt}/>
        </div>
      </div>

      <div className="topup-status" role="status" aria-live="polite">
        <Loader2 size={14} className="row-spinner"/>
        <span>Waiting for payment… the page checks every few seconds.</span>
      </div>

      {topup.qrString && <details className="topup-raw">
        <summary>Can&apos;t scan it? Copy the code</summary>
        <div className="topup-raw-row">
          <code>{topup.qrString}</code>
          <button className="button button-outline compact-button" type="button" onClick={() => void copyString()}>
            {copied ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}
          </button>
        </div>
      </details>}

      {topup.isSandbox && <div className="modal-danger-note">
        <strong>Sandbox</strong>
        <span>This project is not live yet, so the QR cannot be paid from a real wallet. The balance is still credited so the flow can be tested.</span>
      </div>}
    </>}

    {!settled && topup === null && <div className="table-note topup-note">
      <AlertTriangle size={14}/> The QRIS fee is charged on top and is yours to pay, so you receive every credit you asked for.
    </div>}
  </Modal>;
}
