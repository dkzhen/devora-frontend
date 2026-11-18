"use client";

import { useState } from "react";
import { Info } from "lucide-react";

/**
 * Compact red expiry warning above payment method selection. The full explanation
 * is tucked behind the info icon at the bottom-right so the modal stays uncluttered.
 */
export function PaymentExpiryNotice() {
  const [open, setOpen] = useState(false);
  return (
    <div className="payment-expiry-notice" role="note">
      <div className="payment-expiry-notice-body">
        <strong>Payment expires in 15 minutes</strong>
        <span>Check the QR is still active before you transfer.</span>
        {open && (
          <p className="payment-expiry-notice-detail">
            Once marked expired, the status is final and counted as a human error. Payments are
            handled automatically, so a late transfer is very unlikely to be recovered. If you
            already paid after expiry, contact support — the chance of success is very small.
          </p>
        )}
      </div>
      <button
        type="button"
        className="payment-expiry-notice-info"
        aria-label={open ? "Hide expiry details" : "Show expiry details"}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Info size={15} />
      </button>
    </div>
  );
}
