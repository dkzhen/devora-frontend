"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";

/**
 * The landing footer, after OpenRouter's.
 *
 * The shape worth copying is the relationship between the blocks, not their styling: a brand block
 * that holds the identity and the legal line, then a row of link groups, each a small heading over
 * a list. The heading carries full-strength ink and the links sit a step back, so the hierarchy
 * reads from colour rather than from size — which is what lets every element stay at one small
 * text rank without the column turning into a grey smear.
 *
 * Restyled into this house's grammar rather than copied: the theme separates blocks with an ink
 * rule, so the top edge is 2px ink, not a hairline. No rounded corners, no cards.
 *
 * Every href below resolves to a page that exists. A footer of plausible-looking links that 404 is
 * worse than a shorter one, so the groups are only as long as the app is.
 */
type Group = { heading: string; links: { label: string; href: string }[] };

const GROUPS: Group[] = [
  {
    heading: "Product",
    links: [
      { label: "Models", href: "/models" },
      { label: "Events", href: "/events" },
      { label: "Stats", href: "/stats" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    heading: "Console",
    links: [
      { label: "AI Gateway", href: "/console/ai" },
      { label: "Credits", href: "/console/credits" },
      { label: "Billing", href: "/console/billing" },
      { label: "Vouchers", href: "/console/vouchers" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/auth" },
      { label: "Create account", href: "/auth" },
    ],
  },
];

export function LandingFooter() {
  return <footer className="landing-footer">
    <div className="lf-grid">
      <div className="lf-brand">
        <Brand/>
        <p>One platform. More ways to build.</p>
        <span className="lf-copy">© 2026 Devora</span>
      </div>

      {GROUPS.map(g => <div key={g.heading} className="lf-group">
        <h3>{g.heading}</h3>
        <ul>
          {g.links.map(l => <li key={l.label}>
            <Link href={l.href}>{l.label}</Link>
          </li>)}
        </ul>
      </div>)}
    </div>
  </footer>;
}
