"use client";

/**
 * A price, with whatever is going on with it.
 *
 * Three states, and the rule that separates them is worth stating because it is not obvious:
 *
 *   free (event)    `free` + the CHARGED price struck through
 *   discounted      the charged price + the ORIGINAL struck through
 *   normal          the charged price, alone, nothing struck
 *
 * What gets struck through differs between a discount and a free event, and that is deliberate.
 * A discount is a standing reduction — the original is the price that returns if it is lifted, so
 * that is the honest thing to cross out. An event is a campaign with a deadline: when it ends the
 * customer pays the *charged* price, so crossing that out and quoting the original would promise
 * a price that never comes back.
 *
 * At 0% nothing is struck. Crossing out a number identical to the one beside it reads as a
 * mistake, not as a saving.
 *
 * The percentage is deliberately NOT rendered here. A card carries two prices and one saving, so
 * a badge on each line would state the same promotion twice and leave the reader to work out
 * whether they were the same offer. Whatever holds both tags owns the single badge.
 */

export type PriceFacts = {
  /** The number billed. */
  value: string;
  /** The pre-discount figure, or null when there is no discount. */
  original: string | null;
  /** A giveaway — an event, or a catalogue price of zero. */
  free: boolean;
};

export function PriceTag({ price, unit = "/ 1M" }: { price: PriceFacts; unit?: string }) {
  // An event ends and the charged price is what remains, so that is the figure worth crossing
  // out. The original rides along nowhere: it is not the number this campaign is about.
  if (price.free) {
    return <span className="pt pt-free">
      <em>free</em>
      {Number(price.value) > 0 && <><del>{price.value}</del><small>{unit}</small></>}
    </span>;
  }

  const discount = pct(price.original, price.value);
  // Nothing to say. No strikethrough, because crossing out an identical number is noise.
  if (discount === null) {
    return <span className="pt"><span className="pt-now">{price.value}</span><small>{unit}</small></span>;
  }

  // The struck figure sits between the price and its unit, matching the free row above:
  // `<price> <struck> / 1M`. Same order, same small size, so the states read as one thing with
  // two outcomes rather than two designs — and the unit never separates a price from the
  // original it is being measured against.
  return <span className="pt">
    <span className="pt-now">{price.value}</span>
    <del>{price.original}</del>
    <small>{unit}</small>
  </span>;
}

/** The saving, as a percentage, or null when there is none to state. */
export const pct = (original: string | null, value: string): number | null => {
  const o = Number(original), v = Number(value);
  if (original === null || !Number.isFinite(o) || !Number.isFinite(v) || o <= 0 || v >= o) return null;
  return (1 - v / o) * 100;
};

/** `80% OFF`, not `-80%` — a discount reads as a shop sign, not as a table figure. */
export const showPct = (p: number): string => `${Math.round(p * 10) / 10}% OFF`;
