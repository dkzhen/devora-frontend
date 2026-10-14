import Link from "next/link";
import { Brand } from "@/components/brand";

/**
 * The footer for every public page except the landing page.
 *
 * The landing footer is a directory: three columns of links, on the theory that someone who has
 * read the whole pitch wants a route onward. Inside the app that reasoning does not hold — the
 * catalogue, the events list and the pricing table all carry their own navigation above the fold,
 * so a link farm at the bottom is a second nav competing with the first.
 *
 * What is left is what a footer is actually for on those pages: who made this, and what it is.
 * The mark, the line, and the notice. Nothing to click, and nothing that goes stale — a link that
 * 404s is worse than a link that was never offered.
 *
 * Named `PublicFooter` rather than `PageFooter` because the distinction being drawn is
 * landing-vs-public, and the name should say which side of it this is on.
 */
export function PublicFooter() {
  return <footer className="public-footer">
    <div className="pf-inner">
      {/* Brand on the left; the line and the notice stacked on the right. Two columns rather than
          one row of three things, because the brand and the notice are not peers — one names the
          product, the other is a legal line, and putting them on the same baseline implies a
          relationship that is not there. */}
      <div className="pf-brand">
        {/* The full lockup — mark and wordmark, the same component the header uses. The mark alone
            was tried and is worse: an unlabelled 18px glyph is a logo only to someone who already
            knows whose it is, and a footer's one job is to say who. */}
        <Brand/>
      </div>
      <div className="pf-right">
        <p>One platform. More ways to build.</p>
        <span className="pf-copy">© 2026 Devora</span>
      </div>
    </div>
  </footer>;
}
