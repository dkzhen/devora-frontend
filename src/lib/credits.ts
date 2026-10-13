/**
 * Credit formatting, in one place.
 *
 * The sidebar, the credits page and the admin table all show a balance. They must show the
 * same digits, so they share this function rather than each formatting their own way.
 *
 * Input is always the exact decimal string the backend sends (the column is numeric(18,6)).
 * Never parse to a float and multiply: 0.000649 as a float is 0.000648999..., and a balance
 * that drifts is a balance someone disputes.
 */

/** Balance: exact, trailing zeros trimmed, grouped thousands. */
export function formatCredits(credits: string): string {
  const n = Number(credits);
  if (!Number.isFinite(n) || n === 0) return "0";
  const fixed = n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, frac] = fixed.split(".");
  const grouped = Number(whole).toLocaleString();
  return frac ? `${grouped}.${frac}` : grouped;
}

/** A signed ledger amount. Charges are usually sub-credit, so keep six decimals. */
export function formatCharge(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  const shown = abs >= 1 ? abs.toFixed(abs % 1 === 0 ? 0 : 4) : abs.toFixed(6);
  return `${sign} ${shown}`;
}

/** A price per 1M tokens, e.g. "1" or "0.14". */
export function formatPrice(credits: number): string {
  if (!Number.isFinite(credits) || credits === 0) return "0";
  return credits.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Rupiah, grouped, no decimals.
 *
 * Whole rupiah on purpose: the currency has no practical subunit, and "Rp 1.234,56" reads as
 * noise on a price a customer is about to pay. Rounding is explicit rather than left to
 * `toLocaleString`, which would render the cents.
 */
export function formatRupiah(idr: number): string {
  if (!Number.isFinite(idr)) return "—";
  return `Rp ${Math.round(idr).toLocaleString("id-ID")}`;
}

/**
 * Money back into credits at a given rate.
 *
 * For pricing a top-up: the operator types rupiah and the form shows how many credits that buys.
 * Rupiah only — a dollar figure was tried and removed, because a second number to keep in step
 * with `idrPerCredit` is a second number that can be wrong, and QRIS settles in rupiah.
 */
export function moneyToCredits(idr: number, idrPerCredit: string): number {
  const rate = Number(idrPerCredit);
  if (!Number.isFinite(idr) || !Number.isFinite(rate) || rate <= 0) return 0;
  return idr / rate;
}
