"use client";

import Link from "next/link";
import {
  Activity, ArrowUpRight, Boxes, Package, Sparkles, Tags, Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionHead } from "@/components/section-head";

type Feature = {
  /** Small mark beside the card's tag. */
  icon: LucideIcon;
  /**
   * The large mark in the card's corner. Carried per card rather than derived from `color`: a
   * decoration is a design choice about that card's subject, and keying it off the background
   * tint meant two unrelated things were forced to move together.
   */
  decoration: LucideIcon;
  color: string;
  tag: string;
  title: string;
  body: string;
  /**
   * When set, the top-right affordance becomes a real link to this path instead of the
   * decorative arrow. Only a card that has somewhere to send the reader gets one — an arrow that
   * looks clickable and is not is the thing this replaces.
   */
  href?: string;
  linkLabel?: string;
};

/**
 * The card section, as one component.
 *
 * Exists so the heading and the grid can be repeated without the markup being repeated: the second
 * instance sets `offset` and continues the numbering, which keeps `01 /` unique across both grids
 * rather than restarting at `01` and reading as a duplicate.
 *
 * `id` is per instance — two sections cannot share an anchor, and only the first is linked from
 * the nav.
 */
export function FeatureCards({
  id,
  tag,
  heading,
  headAccent,
  browseHref,
  browseLabel,
  cards,
  firstCardNumber = 1,
}: {
  id: string;
  tag: string;
  /** Omit both to render the tag alone — a continuation grid does not need a second headline. */
  heading?: string;
  /** The half of the h2 that carries the accent colour. */
  headAccent?: string;
  cards: Feature[];
  firstCardNumber?: number;
  /**
   * A link pinned to the right of the heading row. Reuses the house pattern the removed pricing
   * section used — small bold label, arrow that nudges right on hover — so no new class is added
   * for a pattern the page already had.
   */
  browseHref?: string;
  browseLabel?: string;
}) {
  return <section className="features-section" id={id}>
    <SectionHead tag={tag} heading={heading} accent={headAccent} href={browseHref} linkLabel={browseLabel}/>
    <div className="feature-grid">
      {cards.map((f, i) => {
        const Icon = f.icon;
        const Deco = f.decoration;
        return <article key={`${firstCardNumber + i}-${f.tag}`} className={`feature-card feature-${f.color}`}>
          <div className="feature-top">
            <div className="feature-icon"><Icon size={20}/></div>
            <span>{f.tag}</span>
            {f.href && f.linkLabel
              ? <Link className="feature-link" href={f.href}>{f.linkLabel} <ArrowUpRight size={15}/></Link>
              : <ArrowUpRight size={18}/>}
          </div>
          <h3>{f.title.split("\n").map((line, n) => <span key={n}>{line}{n === 0 && f.title.includes("\n") ? <br/> : null}</span>)}</h3>
          <p>{f.body}</p>
          <div className="feature-decoration"><Deco size={38}/></div>
        </article>;
      })}
    </div>
  </section>;
}

/**
 * The first grid: what the product is.
 *
 * Icons name the subject, not the old copy — the marks used to describe routing, control and build
 * steps, and stayed put when the cards were rewritten, so they read as decoration.
 */
export const productCards: Feature[] = [
  { icon: Sparkles, decoration: Boxes, color: "mint", tag: "01 / MODELS", title: "Text, Images, Videos, and Audio", body: "Generate anything through a single, unified interface. All major models in one place.", href: "/models", linkLabel: "Browse all" },
  { icon: Activity, decoration: Waves, color: "coral", tag: "02 / OBSERVE", title: "Watch every call land.", body: "A live feed of every request — model, endpoint, status — with lifetime totals and traffic by model.", href: "/stats", linkLabel: "Live stats" },
  { icon: Package, decoration: Tags, color: "violet", tag: "03 / PRICING", title: "Price and Packages", body: "Subscription packages bundle an allowance — a token ceiling, or an open plan that slows past fair use.", href: "/pricing", linkLabel: "See plans" },
];
