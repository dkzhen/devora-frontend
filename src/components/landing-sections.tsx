"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Flame, Gift, Loader2, Sparkles, Zap } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";
import { formatTokens } from "@/lib/tokens";

/* ------------------------------------------------------------------ landing: events */

type LiveEvent = {
  slug: string;
  title: string;
  description: string;
  kind: string;
  state: "running" | "upcoming" | "ended" | "exhausted";
  highlights: { label: string; value: string }[];
  model: { id: string; displayName: string; provider: string | null } | null;
  budget: { tokens: string; used: string } | null;
  endsAt: string;
};

function daysLeft(endsAt: string): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
}

/**
 * A strip of whatever is running right now.
 *
 * Renders nothing at all when there is nothing live — an "Events: none" placeholder on a
 * marketing page is worse than the section simply not being there. The full list lives at
 * /events, which is linked only when there is something to link to.
 */
export function LandingEvents() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/backend/api/v1/events", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { data?: LiveEvent[] };
      setEvents((Array.isArray(data.data) ? data.data : []).filter(e => e.state === "running"));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Nothing to show: no heading, no empty box, no apology.
  if (status !== "ready" || events.length === 0) return null;

  const shown = events.slice(0, 3);

  return <section className="land-events" aria-label="Events running now">
    <div className="land-events-head">
      <div>
        <div className="section-tag"><Flame size={13}/> HAPPENING NOW</div>
        <h2>{events.length === 1 ? "One thing is live." : `${events.length} things are live.`}</h2>
      </div>
      <Link className="land-events-more" href="/events">All events <ArrowRight size={15}/></Link>
    </div>
    <div className="land-events-grid">
      {shown.map((e, i) => <article key={e.slug} className={`land-event land-event-${["mint", "coral", "violet"][i % 3]}`}>
        <div className="land-event-top">
          <span className="land-event-live"><i/> LIVE</span>
          <span className="land-event-clock"><CalendarClock size={12}/>{daysLeft(e.endsAt)}d left</span>
        </div>
        <h3>{e.title}</h3>
        {e.model && <div className="land-event-model-row">
          {e.model.provider && <ProviderMark provider={e.model.provider} size={20}/>}
          <code className="land-event-model">{e.model.id}</code>
        </div>}
        {e.description && <p>{e.description}</p>}
        {e.highlights.length > 0 && <dl className="land-event-facts">
          {e.highlights.slice(0, 2).map((h, n) => <div key={n}><dt>{h.label}</dt><dd>{h.value}</dd></div>)}
        </dl>}
      </article>)}
    </div>
  </section>;
}

/* ------------------------------------------------------------------ landing: pricing */

type PublicModel = {
  id: string;
  name: string;
  provider: string | null;
  contextLength: number | null;
  accessPlans: string[];
  free: boolean;
  capabilities: { vision: boolean; reasoning: boolean; tools: boolean };
  pricing: { unit: string; input: string; output: string };
};

/** The capability flags, as short words. Order fixed so the chips read consistently. */
/** A zero price and an event giveaway are the same offer to a reader, so both read "free". */
function isFreePrice(m: PublicModel, value: string): boolean {
  return m.free || Number(value) === 0;
}

function capabilityChips(m: PublicModel): string[] {
  const out: string[] = [];
  if (m.capabilities.vision) out.push("vision");
  if (m.capabilities.reasoning) out.push("reasoning");
  if (m.capabilities.tools) out.push("tools");
  return out;
}

/**
 * The active catalogue with its real prices.
 *
 * Prices come from the database, not from this file — an operator changing a price in the
 * console changes what the landing page says, with no deploy. Credits are the unit, which is
 * why the section states the conversion rather than pretending to quote dollars.
 */
/**
 * The pricing highlight: the cheapest few, and a link to the full list.
 *
 * Deliberately not the whole catalogue. The landing page's job is to make someone want the
 * product, and a table of forty models does the opposite — it reads as an inventory dump and
 * buries the one fact that matters, which is that a model is cheap. The complete list, with
 * provider marks and search, lives at /models.
 */
export function LandingPricing() {
  const [models, setModels] = useState<PublicModel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/backend/api/v1/models", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { data?: PublicModel[] };
      setModels(Array.isArray(data.data) ? data.data : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Cheapest first. A visitor scanning three cards wants the bottom of the price list, not
  // an arbitrary three.
  const highlighted = useMemo(() =>
    [...models].sort((a, b) => Number(a.pricing.input) - Number(b.pricing.input)).slice(0, 3),
    [models]);

  return <section className="land-pricing" id="pricing" aria-label="Model pricing">
    <div className="land-pricing-head">
      <div>
        <div className="section-tag"><Sparkles size={13}/> PRICING</div>
        <h2>Every model,<br/><span>on the same key.</span></h2>
        <p>One balance covers the whole catalogue. Pay only for the tokens you use — no seat fees, no minimum.</p>
      </div>
      {status === "ready" && models.length > 0 && <Link className="land-pricing-more" href="/models">
        See all {models.length} models <ArrowRight size={15}/>
      </Link>}
    </div>

    {status === "loading" && <div className="land-pricing-state"><Loader2 size={20} className="row-spinner"/><strong>Loading the catalogue…</strong></div>}
    {status === "error" && <div className="land-pricing-state"><Zap size={20}/><strong>Could not load prices</strong><p>The gateway is unavailable right now.</p></div>}
    {status === "ready" && models.length === 0 && <div className="land-pricing-state"><Gift size={20}/><strong>No models published yet</strong></div>}

    {status === "ready" && highlighted.length > 0 && <>
      <div className="land-price-cards">
        {highlighted.map((m, i) => <article key={m.id} className={`land-price-card land-price-card-${["mint", "coral", "violet"][i % 3]}`}>
          <div className="land-price-card-top">
            {m.provider && <ProviderMark provider={m.provider} size={26}/>}
            {m.free && <span className="land-free-pill">EVENT</span>}
          </div>
          <h3>{m.name || m.id}</h3>
          <code className="land-price-card-id">{m.id}</code>
          <dl className="land-price-card-nums">
            <div><dt>Input</dt><dd>{isFreePrice(m, m.pricing.input) ? <em>free</em> : m.pricing.input}</dd></div>
            <div><dt>Output</dt><dd>{isFreePrice(m, m.pricing.output) ? <em>free</em> : m.pricing.output}</dd></div>
          </dl>
          <div className="land-price-card-meta">
            <span>{m.contextLength ? `${formatTokens(m.contextLength)} context` : "—"}</span>
            {capabilityChips(m).length > 0 && <span>{capabilityChips(m).join(" · ")}</span>}
          </div>
        </article>)}
      </div>
    </>}
  </section>;
}
