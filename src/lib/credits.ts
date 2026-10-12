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
