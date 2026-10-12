/**
 * Compact token counts, in the units an operator reads.
 *
 * A budget is counted in billions while a context window tops out in millions, so this is
 * deliberately separate from the context formatter: one function for both would print a 1B
 * budget as "1000M".
 *
 * `B` divides by 1e8 rather than 1e9 so the result keeps one decimal — 1_000_000_000 is "1B",
 * and 1_200_000_000 is "1.2B" rather than a rounded "1B".
 */
export const formatTokens = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  if (n < 1_000_000_000) return `${Math.round(n / 100_000) / 10}M`;
  return `${Math.round(n / 100_000_000) / 10}B`;
};

/**
 * A context window, written out in full: 1_000_000 -> "1,000,000".
 *
 * Deliberately separate from `formatTokens`. That one abbreviates ("1M") because it is used
 * for budgets and running counters, where the unit changes as the number grows and a short
 * form keeps a column readable. A context window is a fixed property of a model — it never
 * ticks up — so there is nothing to abbreviate for, and "1M tokens" asks the reader to do a
 * conversion to answer the only question they have, which is how much fits. The full number
 * with thousands separators answers it outright.
 */
export const formatContext = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
