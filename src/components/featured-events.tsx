"use client";

import { useEffect, useState } from "react";
import { Flame, Layers } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";
import { formatCounter } from "@/lib/format-counter";
import { SectionHead } from "@/components/section-head";

/**
 * Whatever is running or queued up right now, as live data cards.
 *
 * Same card grammar as the models grid above it — identity, ink rule, two figures, a bar — so the
 * two sections read as one family rather than two experiments. What each card MEASURES is what
 * differs, and the component says so where it matters rather than reusing model-shaped language.
 *
 * The bar is the giveaway spending itself down. A model_budget event carries tokens; an
 * announcement carries nothing to spend, so it shows its window instead. Rendering a 0% bar for an
 * announcement would read as "not started" when the truth is "this is not that kind of thing".
 */
type EventModel = {
  id: string;
  displayName: string | null;
  provider: string | null;
} | null;

type EventItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: string;
  state: string;
  model: EventModel;
  budget: { tokens: string; used: string; remaining: string } | null;
  endsAt: string;
};

/** Days left, floored at zero — an ended event should say "0d", never a negative. */
function daysLeft(endsAt: string): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
}

export function FeaturedEvents() {
  const [events, setEvents] = useState<EventItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/backend/api/v1/events", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { data?: EventItem[] } | null) => {
        const all = Array.isArray(d?.data) ? d!.data : [];
        // Running first, then announce first among equals — a live giveaway is the more useful
        // thing to lead with. Capped at three so the row stays a row.
        const rank = (e: EventItem) => (e.state === "running" ? 0 : 1);
        const top = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
        if (alive && top.length > 0) setEvents(top);
      })
      .catch(() => { /* Stays hidden. A landing section must not break the page. */ });
    return () => { alive = false; };
  }, []);

  return <section className="features-section" id="events" aria-label="Events">
    <SectionHead tag="HAPPENING NOW" heading="Running right now," accent="and free while it lasts." href="/events" linkLabel="All Events"/>

    {events === null
      ? null
      : <div className="data-grid">
          {events.map((e, i) => {
            const tokens = e.budget ? Number(e.budget.tokens) : 0;
            const used = e.budget ? Number(e.budget.used) : 0;
            const spent = tokens > 0 ? (used / tokens) * 100 : 0;
            const running = e.state === "running";
            return <article key={e.id} className={`data-card data-card-tint-${["mint", "coral", "violet"][i % 3]}`}>
              <div className="data-card-top">
                {e.model?.provider
                  ? <ProviderMark provider={e.model.provider} size={36}/>
                  : <span className="data-card-fallback"><Flame size={19}/></span>}
                <div className="data-card-id">
                  <strong>{e.title}</strong>
                  <small>{e.model?.displayName ?? (e.kind === "announcement" ? "Announcement" : e.kind.replace(/_/g, " "))}</small>
                </div>
                {/* Dot only. The state is asserted three ways that do not rely on colour:
                    the accessible name, the hover title, and the dot's position beside a title
                    the reader can already identify. */}
                <span
                  className={`event-pill event-pill-${running ? "live" : "closed"}`}
                  role="img"
                  aria-label={running ? "Live" : `Event ${e.state}`}
                  title={running ? "Live" : e.state}
                ><i/></span>
              </div>

              <div className="data-card-rule" role="presentation"/>

              {e.budget
                ? <>
                    {/* Spend is the headline for a giveaway: it says how much is left without
                        the reader subtracting two large numbers in their head. */}
                    <div className="data-card-facts">
                      <div>
                        <span>Left</span>
                        <strong>{formatCounter(Number(e.budget.remaining))}</strong>
                      </div>
                      <div>
                        <span>Ends in</span>
                        <strong>{daysLeft(e.endsAt)}d</strong>
                      </div>
                    </div>

                    <div className="data-card-share">
                      <div className="data-card-bar" role="presentation">
                        {/* Clamped: a stale row can report used > tokens, and a bar wider than its
                            track is a rendering bug, not information. */}
                        <span style={{ width: `${Math.min(Math.max(spent, 1), 100)}%` }}/>
                      </div>
                      <div className="data-card-share-meta">
                        <span>{spent >= 0.1 ? `${spent.toFixed(1)}%` : "<0.1%"}</span>
                        <span>budget spent</span>
                      </div>
                    </div>

                    <div className="data-card-foot">
                      <span>Budget</span>
                      <strong>{formatCounter(tokens)}</strong>
                    </div>
                  </>
                : <>
                    {/* An announcement has no spend, so it shows the facts it does have. */}
                    <div className="data-card-facts">
                      <div>
                        <span>Ends in</span>
                        <strong>{daysLeft(e.endsAt)}d</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong>{running ? "Live" : "Closed"}</strong>
                      </div>
                    </div>
                    {e.description && <p className="data-card-note">{e.description}</p>}
                  </>}
            </article>;
          })}
        </div>}
  </section>;
}
