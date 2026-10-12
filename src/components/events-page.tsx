"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, CalendarClock, Flame, Gift, Loader2, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { ProviderMark } from "@/components/provider-mark";
import { formatTokens } from "@/lib/tokens";

type EventState = "running" | "upcoming" | "ended" | "exhausted";

type Highlight = { label: string; value: string };

type EventCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Which sort of event this is. Decides which blocks the card shows, nothing else. */
  kind: string;
  state: EventState;
  /** Operator-written decoration. Rendered as a row of label/value pairs. */
  highlights: Highlight[];
  cta: { label: string; href: string } | null;
  /** Null for any event that is not about a model. */
  model: {
    id: string;
    displayName: string;
    provider: string;
    contextLength: number | null;
    supportsVision: boolean;
    free: boolean;
    pricing: { unit: string; input: string; output: string };
  } | null;
  /** Null when the event carries no budget. */
  budget: { tokens: string; used: string; remaining: string } | null;
  startsAt: string;
  endsAt: string;
};

/** Whole days left, rounded up, because "1 day left" is true until the last minute passes. */
function daysLeft(endsAt: string): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
}

function hoursLeft(endsAt: string): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 3_600_000));
}

/**
 * How much of the budget is gone, or null when there is no budget to measure.
 *
 * Clamped at 100: an event can be slightly overshot by whatever was in flight when it filled
 * up, and a bar reporting 104% would read as a bug rather than a fact.
 */
function usedPercent(e: EventCard): number | null {
  if (!e.budget) return null;
  const cap = Number(e.budget.tokens);
  const used = Number(e.budget.used);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  return Math.min(100, Math.round((used / cap) * 100));
}

/** Each card carries one of the three house accents, so a row of them reads as a set. */
const ACCENTS = ["mint", "coral", "violet"] as const;

const STATE_LABEL: Record<EventState, string> = {
  running: "Live now",
  upcoming: "Starting soon",
  exhausted: "Budget used up",
  ended: "Finished",
};

export function EventsPage() {
  const [events, setEvents] = useState<EventCard[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/events", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      const data = await res.json() as { data?: EventCard[] };
      setEvents(Array.isArray(data.data) ? data.data : []);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const live = events.filter(e => e.state === "running");

  return <main className="landing events-landing">
    {/* The same nav as the marketing page, so arriving from / does not feel like leaving
        the product. "Open console" stays: most visitors have an account already. */}
    <nav className="landing-nav">
      <Brand/>
      <div className="landing-links"><Link href="/#why">Why Devora</Link><Link href="/#how">How it works</Link><Link href="/events">Events</Link></div>
      <PrimaryLink href="/console/billing">Open console</PrimaryLink>
    </nav>

    <section className="ev-hero">
      <div className="ev-hero-content">
        <div className="eyebrow"><span className="eyebrow-mark"><Flame size={15}/></span>
          {live.length > 0 ? `${live.length} event${live.length === 1 ? "" : "s"} running` : "What is on"}
        </div>
        <h1>{live.length > 0
          ? <>Happening <span>right now</span>.</>
          : <>Events, <span>as they come</span>.</>}</h1>
        <p className="hero-copy">
          Launches, giveaways, free models and maintenance windows — anything the workspace is
          running, with the dates and the details that matter.
        </p>
        <div className="hero-actions">
          <PrimaryLink href="/auth?next=%2Fconsole%2Fbilling">Get an API key</PrimaryLink>
          <Link className="text-link" href="/#how">How it works <ArrowDownRight size={16}/></Link>
        </div>
      </div>
      <div className="ev-hero-art">
        <div className="ev-badge ev-badge-a">NEW</div>
        <div className="ev-badge ev-badge-b">LIVE</div>
        <div className="ev-cube">
          <div className="ev-cube-top">✳</div>
          <div className="ev-cube-front">%</div>
          <div className="ev-cube-side"/>
        </div>
        <span className="ev-star ev-star-a">✳</span>
        <span className="ev-star ev-star-b">✦</span>
      </div>
    </section>

    <section className="ev-list">
      <div className="ev-list-head">
        <div className="section-tag">WHAT IS ON OFFER</div>
        <h2>{live.length > 0 ? <>Running <span>now.</span></> : <>Nothing <span>live yet.</span></>}</h2>
      </div>

      {status === "loading" && <div className="ev-empty"><Loader2 size={22} className="row-spinner"/><strong>Loading events…</strong></div>}

      {status === "error" && <div className="ev-empty"><Zap size={22}/><strong>Could not load events</strong><p>The gateway is unavailable right now. Try again shortly.</p></div>}

      {status === "ready" && events.length === 0 && <div className="ev-empty">
        <Gift size={22}/><strong>No events running</strong>
        <p>Check back — new ones start regularly. Everything in the catalogue is available from your console.</p>
      </div>}

      {status === "ready" && events.length > 0 && <div className="ev-grid">
        {events.map((e, i) => {
          const pct = usedPercent(e);
          const running = e.state === "running";
          const accent = ACCENTS[i % ACCENTS.length];
          return <article key={e.id} className={`ev-card ev-card-${accent}${running ? " ev-card-live" : ""}`}>
            <div className="ev-card-top">
              <span className={running ? "ev-state ev-state-live" : "ev-state ev-state-idle"}>
                {running && <span className="ev-pulse"/>}{STATE_LABEL[e.state]}
              </span>
              {running && <span className="ev-clock"><CalendarClock size={13}/>
                {daysLeft(e.endsAt) > 1 ? `${daysLeft(e.endsAt)}d left` : `${hoursLeft(e.endsAt)}h left`}
              </span>}
            </div>

            <h3 className="ev-title">{e.title}</h3>
            {e.description && <p className="ev-desc">{e.description}</p>}

            {/* Operator-written facts. Shown for every kind, because whatever an event is
                about, these are the numbers a reader looks for. */}
            {e.highlights.length > 0 && <dl className="ev-facts">
              {e.highlights.map((h, n) => <div key={n} className="ev-fact">
                <dt>{h.label}</dt><dd>{h.value}</dd>
              </div>)}
            </dl>}

            {/* The model block exists only when the event names a model — it is not a slot
                that every card leaves empty. */}
            {e.model && <div className="ev-model">
              <div className="ev-model-provider">
                {e.model.provider && <ProviderMark provider={e.model.provider} size={22}/>}
                <code className="ev-model-id">{e.model.id}</code>
              </div>
              <div className="ev-model-meta">
                <span>{e.model.displayName}</span>
                {e.model.contextLength && <span>· {formatTokens(e.model.contextLength)} ctx</span>}
              </div>
            </div>}

            <div className="ev-card-foot">
              {e.model && (running
                ? <span className="ev-free"><Check/> Free while live</span>
                : <span className="ev-price-normal">↓ {e.model.pricing.input} · ↑ {e.model.pricing.output} <small>cr / 1M</small></span>)}

              {/* No budget means no meter. An empty bar would suggest a budget of zero. */}
              {pct !== null && e.budget && <div className="ev-budget">
                <div className="ev-budget-row">
                  <span>Budget</span>
                  <strong>{formatTokens(Number(e.budget.used))} / {formatTokens(Number(e.budget.tokens))}</strong>
                </div>
                <div className={pct >= 100 ? "ev-bar ev-bar-full" : "ev-bar"}><i style={{ width: `${pct}%` }}/></div>
              </div>}

              {e.cta && <a className="ev-cta" href={e.cta.href}>{e.cta.label} <ArrowRight size={14}/></a>}
            </div>

            <div className="ev-card-window">Ends {new Date(e.endsAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </article>;
        })}
      </div>}

      <div className="ev-foot-note">
        <Zap size={15}/> Budgets are measured in tokens as reported by the model provider.
      </div>
    </section>

    <footer className="landing-footer">
      <Brand/>
      <p>One platform. More ways to build.</p>
      <span className="landing-footer-copy">© 2026 Devora</span>
    </footer>
  </main>;
}

/** A tick, drawn rather than imported, so the accent colour follows the card. */
function Check() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>;
}
