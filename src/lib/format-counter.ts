/**
 * Compact counters — counters, not prices. A token total that ticks upward should not reflow
 * the layout, so a figure is abbreviated to one decimal at most.
 *
 * This is the single formatter for that job across the console and /stats. Each page used to
 * carry its own copy, and the copies drifted: two of them divided the B branch by 1e9 and then
 * by 10 — an effective 1e10 — so 1,116,017,684 read as "0.1B" on the admin pages against
 * "1.1B" on /stats for the very same number. One function, one answer.
 *
 * One decimal is shown only while it carries information: 12.3K, 1.5M, but 123K and 45M, so a
 * four-digit figure does not spend a character on ".0".
 *
 * The ladder runs to T (trillion). It used to stop at B, which was fine while the gateway had
 * served tens of millions of tokens and wrong the moment a token total crossed 1e12 — it would
 * have printed "1234.5B". A figure that long is what breaks the layout, so the sequence keeps
 * going rather than silently widening.
 */
export const formatCounter = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  // Below the first unit the number stands on its own: "999" is a figure, "1K" is a lie.
  if (Math.abs(n) < 1000) return String(n);
  // Ascending, so a value that rounds onto the next unit can fall through to it.
  const UNITS: [number, string][] = [[1000, "K"], [1_000_000, "M"], [1_000_000_000, "B"], [1_000_000_000_000, "T"]];
  for (let i = 0; i < UNITS.length; i++) {
    const [scale, suffix] = UNITS[i];
    const value = n / scale;
    // One decimal only while it carries information — 12.3K and 1.5M, but 123K and 7M.
    const shown = value.toFixed(value < 10 ? 1 : 0);
    // Rounding can carry a value onto the next unit: 999,999 becomes "1000K". Four digits plus a
    // suffix is exactly the shape that breaks a stat row, so promote instead of printing it.
    if (UNITS[i + 1] && Number(shown) >= 1000) continue;
    return `${shown.endsWith(".0") ? shown.slice(0, -2) : shown}${suffix}`;
  }
  // Past T: hold the largest unit rather than invent one.
  return `${(n / 1e12).toFixed(0)}T`;
};

/**
 * A credit figure for display: at most two decimals, no trailing zeros.
 *
 * Credits are stored as micro-credits, so a raw value carries six decimals — "27.731260" — and
 * a figure that long is the thing that breaks a stat row, not the number of digits before the
 * point. Two decimals is the same precision the billing pages already show.
 */
export const formatCredits = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
