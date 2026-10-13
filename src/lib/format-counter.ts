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
 */
export const formatCounter = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  // One decimal only while it carries information — 12.3K and 1.5M, but 123K and 7M, so a
  // whole figure does not spend a character on ".0".
  const unit = (v: number, scale: number, threshold: number) => {
    const shown = (v / scale).toFixed(v < threshold ? 1 : 0);
    return `${shown.endsWith(".0") ? shown.slice(0, -2) : shown}`;
  };
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${unit(n, 1000, 10_000)}K`;
  if (n < 1_000_000_000) return `${unit(n, 1_000_000, 10_000_000)}M`;
  return `${unit(n, 1_000_000_000, 1e21)}B`;
};
