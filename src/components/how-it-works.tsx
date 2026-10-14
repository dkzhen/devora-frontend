"use client";

import Link from "next/link";
import { CreditCard, Gem, KeyRound, UserPlus } from "lucide-react";
import { SectionHead } from "@/components/section-head";

/**
 * Four steps from nothing to a running bill, after OpenRouter's "How it works".
 *
 * The shape worth taking is the tile: a numbered dot beside a label, one sentence, then a visual
 * that shows the step rather than describing it. OpenRouter illustrates step 3 with a masked key,
 * which is the piece of information a reader actually wants at that moment — so each tile here
 * ends in a small mock of the real thing (the signup form, the top-up, the key).
 *
 * The steps describe THIS app, not OpenRouter's: email and password rather than OAuth, QRIS in
 * rupiah rather than dollars, and the key the console really issues. A guide that promises a flow
 * the product does not have is worse than no guide.
 *
 * Styled in the house grammar — ink rules, no radius, hard offset shadow — rather than copied from
 * the reference, which is a Tailwind design with rounded muted tiles.
 */
const STEPS = [
  {
    n: "01",
    icon: UserPlus,
    title: "Create an account",
    body: "Sign up with your email. Your workspace is ready immediately — no team setup required.",
    href: "/auth",
    linkLabel: "Sign up",
  },
  {
    n: "02",
    icon: CreditCard,
    title: "Add credits",
    body: "Top up by QRIS or crypto. One balance covers every model, and each charge is itemised to the token.",
    href: "/console/credits",
    linkLabel: "Top up",
  },
  {
    n: "03",
    icon: KeyRound,
    title: "Get your API key",
    body: "Issue a key and point any OpenAI-compatible client at the gateway. Nothing else to install.",
    href: "/console/ai",
    linkLabel: "Open gateway",
  },
  {
    n: "04",
    icon: Gem,
    title: "Or take a package",
    body: "Prefer a flat rate? A subscription package bundles an allowance — a token ceiling, or an open plan that throttles past fair use. Buy one directly, or activate it with a gift voucher.",
    href: "/pricing",
    linkLabel: "See pricing",
  },
];

export function HowItWorks() {
  return <section className="how-section" id="how" aria-label="How it works">
    <SectionHead tag="HOW IT WORKS" heading="Four steps," accent="then you're building." href="/console/billing" linkLabel="Open Console"/>

    <ol className="how-grid">
      {STEPS.map(s => {
        const Icon = s.icon;
        return <li key={s.n} className="how-step">
          <div className="how-step-top">
            <span className="how-num">{s.n}</span>
            <Icon size={19}/>
            <h3>{s.title}</h3>
          </div>
          <p>{s.body}</p>

          {/* The visual: a mock of the real surface, so the step shows what to expect rather than
              only saying it. Each mock is deliberately abstract — bars stand in for text, the key
              is masked — because a guide should not print a real credential shape. */}
          <div className="how-art" aria-hidden="true">
            {s.n === "01" && <div className="how-art-form">
              <span className="how-art-field"/><span className="how-art-field"/>
              <span className="how-art-field how-art-field-short"/>
              <span className="how-art-btn">Create account</span>
            </div>}
            {s.n === "02" && <div className="how-art-pay">
              <span className="how-art-row"><em>Amount</em><b>Rp50.000</b></span>
              <span className="how-art-row"><em>Credits</em><b>50.000</b></span>
              <span className="how-art-qr"/>
            </div>}
            {s.n === "03" && <div className="how-art-key">
              <code>DEVORA_API_KEY</code>
              <span className="how-art-mask">••••••••••••••••</span>
            </div>}
            {s.n === "04" && <div className="how-art-pay">
              <span className="how-art-row"><em>Allowance</em><b>Token cap</b></span>
              <span className="how-art-row"><em>Activate by</em><b>Buy / Gift</b></span>
              <span className="how-art-voucher">Gift voucher</span>
            </div>}
          </div>

          <Link className="how-link" href={s.href}>{s.linkLabel} →</Link>
        </li>;
      })}
    </ol>
  </section>;
}