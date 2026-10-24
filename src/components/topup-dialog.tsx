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
  /**
   * The SERVER's verdict on whether this order is past its deadline — the same deadline the
   * backend reconciles against, with the same grace period.
   *
   * The client cannot decide this alone: `expiresAt` is rendered on the reader's clock, which may
   * be minutes off, and a page left open overnight would otherwise keep showing an order as
   * payable long after the backend closed it. The local countdown is still used, because a payer
   * staring at a live code should not have to wait for the next poll to be told it died.
   */
  expired: boolean;
};

/** A handful of sensible sizes. The field takes any whole number of credits. */
const MIN_TOPUP = 1_000;
const PRESETS = [1_000, 5_000, 10_000, 25_000];

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

/**
 * Milliseconds until `expiresAt`, ticking once a second.
 *
 * `null` means there is no deadline (the gateway did not send one); a value `<= 0` means it has
 * passed. One hook, used by both the countdown display and the dialog's own "the code is dead"
 * decision, so the text and the behaviour cannot disagree about when expiry happened.
 */
function useTimeLeft(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) { setLeft(null); return; }
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) { setLeft(null); return; }
    const tick = () => setLeft(ms - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return left;
}

function Countdown({ left }: { left: number | null }) {
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
  const [paymentReady, setPaymentReady] = useState<boolean | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");

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

  // Pre-flight: check that Pakasir is ready before allowing a QRIS payment.
  // Fetched when the dialog opens — not polled, because it is a one-time gate, not a live status.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPaymentReady(null);
    setPaymentMessage("");
    fetch("/backend/api/v1/health/pakasir")
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setPaymentReady(true);
        } else {
          setPaymentReady(false);
          res.json()
            .then((body: { message?: string }) => {
              if (!cancelled) setPaymentMessage(body?.message ?? "The payment gateway is not available.");
            })
            .catch(() => {
              if (!cancelled) setPaymentMessage("The payment gateway is not available.");
            });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPaymentReady(false);
        setPaymentMessage("Could not reach the payment gateway.");
      });
    return () => { cancelled = true; };
  }, [open]);

  const create = async () => {
    setError("");
    const n = Number(credits);
    if (!Number.isFinite(n) || n < MIN_TOPUP) { setError(`Minimum top-up is ${MIN_TOPUP.toLocaleString()} credits.`); return; }
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

  /**
   * Poll while an order is open and still pending.
   *
   * Keyed on `orderId` and the STATUS as scalars, not on the `topup` object. Depending on the
   * object meant every response replaced it, which re-ran this effect and reset `cancelled` —
   * so the old interval was cleared and a new one started on every tick, and the guard that was
   * supposed to stop polling once the order settled never actually stopped anything. Scalars only
   * change when the thing they describe changes.
   *
   * It also stops once the QR's own deadline has passed: past expiry the gateway has cancelled
   * the order, so there is nothing left to poll for. One final poll is made first, because the
   * authoritative answer is still the gateway's and it may have settled microseconds before the
   * deadline.
   */
  const orderId = topup?.orderId ?? null;
  const orderStatus = topup?.status ?? null;
  const expiresAt = topup?.expiresAt ?? null;

  useEffect(() => {
    if (!open || orderId === null || orderStatus !== "pending") return;
    let stopped = false;
    let handle: number | undefined;

    const expiryMs = expiresAt === null ? null : new Date(expiresAt).getTime();

    const poll = async () => {
      try {
        const res = await fetch(`/backend/api/v1/topups/${encodeURIComponent(orderId)}`, {
          headers: await authHeaders(), cache: "no-store",
        });
        if (stopped) return;
        if (!res.ok) {
          // A 409 means the payment landed but was refused (a sandbox payment on a live
          // workspace). That is a terminal answer the payer has to be told about, not a transient
          // failure to retry silently — the earlier version dropped every non-ok response and the
          // dialog spun forever behind it.
          const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
          if (res.status === 409 && body?.error?.message) {
            setError(body.error.message);
            if (handle !== undefined) window.clearInterval(handle);
            stopped = true;
          }
          return;
        }
        const data = await res.json() as { topup?: Topup };
        if (stopped || !data.topup) return;
        setTopup(prev => (prev === null ? data.topup! : { ...prev, ...data.topup! }));
        // `settled` is derived from the status, so nothing to flip here — only the page needs
        // telling that the balance moved.
        if (data.topup.status === "completed") onSettled();
        // Terminal state: nothing further can change, so stop asking.
        if (data.topup.status !== "pending" && handle !== undefined) {
          window.clearInterval(handle);
          stopped = true;
        }
      } catch { /* a poll failure is not worth surfacing — the next tick retries */ }
    };

    handle = window.setInterval(() => {
      if (stopped) return;
      if (expiryMs !== null && Number.isFinite(expiryMs) && Date.now() > expiryMs) {
        // Past the deadline: ask once more, then stop for good.
        window.clearInterval(handle!);
        stopped = true;
        void poll();
        return;
      }
      void poll();
    }, POLL_MS);

    return () => {
      stopped = true;
      if (handle !== undefined) window.clearInterval(handle);
    };
  }, [open, orderId, orderStatus, expiresAt, authHeaders, onSettled]);

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

  /**
   * Whether the QR can still be paid.
   *
   * Two independent things make it dead, and either is enough: the local deadline passed, or the
   * order moved out of `pending` (canceled by the gateway, or refused at the credit step). They
   * are separate because the deadline is the client's clock while the status is the server's
   * verdict — the display must react to both, since a payer staring at an expired code will not
   * wait for the next poll to be told.
   *
   * `sandboxRefused` picks the truthful message: "expired, you were not charged" reads very
   * differently from "you paid and we did not credit it".
   */
  const timeLeft = useTimeLeft(topup?.expiresAt ?? null);
  const pastDeadline = timeLeft !== null && timeLeft <= 0;
  // The poll route answers `sandbox_payment` (409) when a payment landed but was refused at the
  // credit step. That message is what distinguishes the two dead cases, and it arrives on its own
  // — the order may still read `pending` in the client's copy, so it must not be gated on status.
  const sandboxRefused = error.includes("sandbox mode");
  const terminalButUnsettled = topup !== null && topup.status !== "pending" && !settled;
  // `topup.expired` is the server's verdict; `pastDeadline` is the local clock. Either closes the
  // dialog — the server's is authoritative, the local one is what stops a payer waiting.
  const dead = pastDeadline || terminalButUnsettled || sandboxRefused || topup?.expired === true;

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
            <button className="button button-ink compact-button" type="button" onClick={() => void create()} disabled={creating || Number(credits) < MIN_TOPUP || paymentReady === false}>
              {creating ? <><Loader2 size={15} className="row-spinner"/> Creating…</> : <>Show QR code <QrCode size={15}/></>}
            </button>
          </>
        : <>
            <button className="button button-outline" type="button" onClick={onClose}>Close</button>
            <button className="button button-ink compact-button" type="button" onClick={() => void create()} disabled={creating || Number(credits) < MIN_TOPUP}>
              {creating ? <><Loader2 size={15} className="row-spinner"/> Creating…</> : <>Create QR</>}
            </button>
          </>}
    >
    {error && <p className="voucher-message voucher-error" role="alert"><X size={14}/>{error}</p>}
    {!settled && topup === null && Number(credits) < MIN_TOPUP && (
      <p className="voucher-message voucher-error"><AlertTriangle size={14}/> Minimum top-up is {MIN_TOPUP.toLocaleString()} credits.</p>
    )}
    {!settled && topup === null && paymentReady === false && (
      <p className="voucher-message voucher-error"><AlertTriangle size={14}/> Payment is not available right now. {paymentMessage}</p>
    )}

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
          <input value={credits} type="number" min={MIN_TOPUP} step="1" placeholder="25000"
            onChange={e => setCredits(e.target.value)} />
        </label>
        {/* Raw digits above, the reading below — the same rule the admin forms follow. */}
        <p className="admin-scale-note" aria-live="polite">
          {Number(credits) >= MIN_TOPUP
            ? <><strong>{formatRupiah(Math.round(Number(credits)))}</strong> plus the QRIS fee, paid by you</>
            : <><strong>—</strong> Minimum is {MIN_TOPUP.toLocaleString()} credits.</>}
        </p>
      </div>
    </>}

    {!settled && topup !== null && <>
      <div className="topup-pay">
        {/* A dead code is not shown. Leaving a scannable-looking QR above a box that says it
            cannot be scanned is the contradiction the payer would act on — they would scan it,
            get nothing, and have no idea which of the two messages to believe. */}
        {dead
          ? <div className="topup-qr topup-qr-dead" aria-hidden>
              <span className="topup-qr-void"><QrCode size={30}/><small>CODE EXPIRED</small></span>
            </div>
          : <div className="topup-qr">
              {topup.qrString
                ? <QrCanvas value={topup.qrString}/>
                : <div className="table-empty"><QrCode size={22}/><strong>No QR returned</strong></div>}
            </div>}
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
          {!dead && <Countdown left={timeLeft}/>}
        </div>
      </div>

      {/* The code is dead but the order never settled. Without this the dialog kept showing a
          scannable QR and "waiting for payment" indefinitely, because the local countdown and
          the poll disagreed about what expiry meant. */}
      {dead ? <div className="topup-dead" role="status">
        <Clock size={15}/>
        <div>
          <strong>{sandboxRefused ? "Sandbox payment not credited" : "This code has expired"}</strong>
          <span>
            {sandboxRefused
              ? "The payment went through, but this project is in sandbox mode so no credits were added."
              : "It was not paid in time, so it is canceled and cannot be scanned."}
            {" "}Start a new one to try again.
          </span>
        </div>
      </div> : <div className="topup-status" role="status" aria-live="polite">
        <Loader2 size={14} className="row-spinner"/>
        <span>Waiting for payment… the page checks every few seconds.</span>
      </div>}

      {!dead && topup.qrString && <details className="topup-raw">
        <summary>Can&apos;t scan it? Copy the code</summary>
        <div className="topup-raw-row">
          <code>{topup.qrString}</code>
          <button className="button button-outline compact-button" type="button" onClick={() => void copyString()}>
            {copied ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy</>}
          </button>
        </div>
      </details>}

      {!dead && topup.isSandbox && <div className="modal-danger-note">
        <strong>Sandbox</strong>
        <span>This project is not live yet, so the QR cannot be paid from a real wallet. The balance is still credited so the flow can be tested.</span>
      </div>}
    </>}

    {!settled && topup === null && <div className="table-note topup-note">
      <AlertTriangle size={14}/> The QRIS fee is charged on top and is yours to pay, so you receive every credit you asked for.
    </div>}
  </Modal>;
}
