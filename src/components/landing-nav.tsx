"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand, PrimaryLink } from "@/components/brand";

/**
 * The shared landing nav, used on every public page.
 *
 * The link to the page the visitor is on is hidden — a nav that points to the page
 * you are already reading is noise. `usePathname` is the source of truth: the anchor
 * `/#how` maps to the landing page (`/`), so the home link disappears there too.
 */
const NAV_LINKS: { href: string; label: string; match: string }[] = [
  { href: "/#how", label: "How it works", match: "/" },
  { href: "/models", label: "Models", match: "/models" },
  { href: "/stats", label: "Stats", match: "/stats" },
  { href: "/events", label: "Events", match: "/events" },
  { href: "/pricing", label: "Pricing", match: "/pricing" },
];

export function LandingNav() {
  const pathname = usePathname() ?? "/";
  // The landing page has hash anchors (#how, #faq) but the pathname is still "/".
  // Any path starting with "/" that is not a known sub-page is the landing page.
  const isLanding = pathname === "/" || !NAV_LINKS.some(l => l.match === pathname);

  return (
    <nav className="landing-nav">
      <Brand/>
      <div className="landing-links">
        {NAV_LINKS
          .filter(l => isLanding ? l.match !== "/" : l.match !== pathname)
          .map(l => <Link key={l.href} href={l.href}>{l.label}</Link>)}
      </div>
      <PrimaryLink href="/console/billing">Open console</PrimaryLink>
    </nav>
  );
}
