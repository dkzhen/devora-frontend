"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The heading row every landing section shares: a small uppercase tag on the left, an optional
 * headline under it, and an optional link pinned to the right.
 *
 * Extracted because four sections had grown the same three pieces of markup with slightly
 * different spacing. Sharing them means a section cannot drift from its neighbours by half a
 * pixel, and the tag row's mobile behaviour (the outer heading stacks, so the tag and the link
 * need their own row to stay on one line) is solved once instead of four times.
 *
 * The link slot reuses `.land-pricing-more`, the house pattern the removed pricing section left
 * behind — same class wherever a section links out, so the affordance reads identically.
 *
 * `linkLabel` is written in Title Case, matching every other instance. Casing is not decoration:
 * three of these sat side by side in two different cases and read as two different components,
 * even though the type was byte-identical.
 */
export function SectionHead({
  tag,
  heading,
  accent,
  href,
  linkLabel,
}: {
  tag: string;
  /** Omit for a section that is a continuation and needs no second headline. */
  heading?: string;
  /** The half of the headline that carries the accent colour. */
  accent?: string;
  href?: string;
  linkLabel?: string;
}) {
  return <div className="features-heading">
    <div>
      <div className="features-tag-row">
        <div className="section-tag">{tag}</div>
        {href && linkLabel && <Link className="land-pricing-more" href={href}>
          {linkLabel} <ArrowRight size={15}/>
        </Link>}
      </div>
      {heading && accent && <h2>{heading}<br/><span>{accent}</span></h2>}
    </div>
  </div>;
}
