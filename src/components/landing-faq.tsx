"use client";

import { FaqAccordion, type FaqItem } from "@/components/faq-accordion";

/**
 * Questions a first-time reader asks, after the four steps.
 *
 * Same disclosure control as /events — literally the same component, not a lookalike — so the two
 * pages cannot drift apart. What differs is the subject: /events answers questions about events,
 * this answers questions about the product.
 *
 * No badge. The heading already says what the block is, and a "FAQ" chip above it was a second
 * label for the same thing.
 *
 * Answers are traceable to how the product behaves; no figure here is invented.
 */
const LANDING_FAQ: FaqItem[] = [
  {
    q: "What is Devora, in one line?",
    a: "One gateway in front of the models you already use. You keep one API key and one balance, and every model is reachable through the same OpenAI-compatible endpoint.",
  },
  {
    q: "Do I have to change my code to switch models?",
    a: "No. Change the model id in the request and nothing else. The endpoint, the request shape and the key stay the same, so a client written against any OpenAI-compatible library works without modification.",
  },
  {
    q: "How does billing work?",
    a: "One balance in credits, charged per token as you use it. There are no seat fees and no monthly minimum, and every request is itemised so a bill can be traced back to a call.",
  },
  {
    q: "What are the subscription packages for?",
    a: "Package = cloud subscription. Buy one with a card or QRIS and it becomes a subscription on your account; a gift voucher activates the same package, which is how you hand one to someone else. Either way the allowance is a fixed token ceiling, or an open plan that slows past a fair-use threshold.",
  },
  {
    q: "Can I see what the gateway is doing?",
    a: "Yes, live. The stats page shows a feed of recent requests with their model and status, how the whole catalogue is priced, and how traffic is distributed across models — counted over the lifetime of the workspace.",
  },
  {
    q: "How can I pay?",
    a: "QRIS or crypto, both into the same balance. Which rail you use makes no difference to your keys, your models or your pricing.",
  },
];

export function LandingFaq() {
  return <section className="land-faq" id="faq" aria-label="Frequently asked questions">
    <div className="ev-faq">
      <div className="ev-faq-head">
        <h2>The details, up front.</h2>
        <p>The things people ask before their first request.</p>
      </div>
      <FaqAccordion id="landing" items={LANDING_FAQ}/>
    </div>
  </section>;
}
