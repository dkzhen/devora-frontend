"use client";

import { formatCounter } from "@/lib/format-counter";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Boxes, Layers, Loader2, RefreshCw, Server, X, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { ProviderMark } from "@/components/provider-mark";

/* The public statistics page.

   Read-only, unauthenticated, and deliberately shallow: throughput and catalogue size.
   No account counts and no per-user figure, because at this size an average per account
   is invertible back to one account's usage — see the endpoint's own note.

   Every number here comes from the all-time snapshot, not the per-request ledger, so
   nothing on this page moves when an operator prunes history. That is the whole reason
   the figures are worth publishing.

   Grouped by source rather than laid out flat. Today there is one group — the gateway —
   and the grouping exists so the next set of figures (billing, delivery, uptime) lands in
   its own section instead of joining an undifferentiated pile. A page that says "Gateway"
   above its numbers also answers the question a reader would otherwise have to ask: whose
   totals are these? */

type Stats = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelsUsed: number;
  models: number;
  providers: number;
  activeEvents: number;
  firstRequestAt: string | null;
  lastRequestAt: string | null;
  /** Ten latest calls. `model` is null for endpoints that address no model. */
  recentRequests: {
    at: string;
    endpoint: string;
    status: number;
    model: { id: string; name: string | null; provider: string | null } | null;
  }[];
  modelBreakdown: {
    id: string;
    name: string | null;
    provider: string | null;
    /** null = no longer in the catalogue; "inactive" = still there, switched off. */
    status: string | null;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }[];
};

type Status = "loading" | "ready" | "error";


/** Full figure, for the line under a compact one — the exact number is the trust signal. */
const full = (n: number): string => n.toLocaleString("en-US");

const shortDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "12s ago" / "4m ago" / "3h ago". Coarse on purpose: the feed is read for recency, and a
 *  to-the-second timestamp on a public page reads as a log file rather than as activity. */
function ago(iso: string) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Absolute timestamp for the title attribute, where precision is appropriate. */
function whenFull(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
}

/** Wall clock, ticking. Always seconds precision so the page is visibly alive even when the
 *  newest request is hours old — a minutes-only clock would sit still on quiet traffic and
 *  the liveness would be invisible exactly when it is the only thing moving. */
function clock(d: Date): { hms: string; day: string } {
  return {
    hms: d.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  };
}

/** Coarse age, but capped at minutes so it moves instead of freezing on "7h ago". */
function ageShort(iso: string, now: number) {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/** "14:07:33.02" — hours:minutes:seconds.centiseconds, in the visitor's own time so a feed row
 *  reads on the same clock as the live indicator above it. Built from the Date's local getters
 *  rather than `toISOString()`, which is UTC by definition and was showing a different hour
 *  than the header. The hundredths come from the timestamp itself, not a counter, so the digits
 *  only change when the data refreshes — decoration that is also true. */
function subSeconds(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(Math.floor(d.getMilliseconds() / 10))}`;
}

/** The row's OWN day and time (local), not today's. Reading the day off the live clock showed
 *  every row dated today while the time belonged to the request — a request made yesterday
 *  evening rendered as a future time on today's date. The `title` always carried the truth;
 *  now the visible line does too. */
function feedStamp(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
  };
}

export function StatsPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/backend/api/v1/stats", { cache: "no-store" });
      if (!res.ok) { setStatus("error"); return; }
      setData(await res.json() as Stats);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Two separate things, on purpose.
     `now` drives the clock and is re-read every second: it is local, free, and the only
     way the page can look live while traffic is quiet. It never touches the network.
     The refresh effect re-reads the feed, but only silently and only when the tab is
     visible — a background tab polling a public endpoint on a timer is traffic nobody
     asked for. `load` is deliberately not called with its loading state set here, so the
     figures do not blink back to a spinner every tick. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/backend/api/v1/stats", { cache: "no-store" });
      if (!res.ok) return;
      setData(await res.json() as Stats);
      setSyncedAt(Date.now());
    } catch {
      /* Kept quiet. A failed background poll should not replace a working page with an
         error state — the figures on screen are still the last ones known to be good. */
    }
  }, []);

  useEffect(() => {
    const REFRESH_MS = 15_000;
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  const clk = clock(new Date(now));
  const newest = data?.lastRequestAt ?? null;

  return <main className="landing events-landing">
    {/* The same nav as every other public page, so arriving here does not feel like a
        different site. */}
    <nav className="landing-nav">
      <Brand/>
      <div className="landing-links"><Link href="/#why">Why Devora</Link><Link href="/#how">How it works</Link><Link href="/events">Events</Link><Link href="/stats">Stats</Link><Link href="/pricing">Plans</Link></div>
      <PrimaryLink href="/console/billing">Open console</PrimaryLink>
    </nav>

    <section className="mp-head">
      <div className="section-tag"><Activity size={13}/> SERVICE FIGURES</div>
      <h1>Stats</h1>
      <p>What the gateway has served, and what it serves it with. Counted across the lifetime of the workspace.</p>
    </section>

    <section className="st-body">
      {status === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading figures…</strong><p>Reading the totals.</p></div>}

      {/* An error here is a real fault, not an unconfigured source: the figures come from
          tables the gateway writes on every request, so their absence means something broke. */}
      {status === "error" && <div className="table-empty"><X size={19}/><strong>Could not load figures</strong><p>The statistics service did not respond.</p><button type="button" className="button button-outline compact-button" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}

      {status === "ready" && data && <>

        {/* ── Gateway ──────────────────────────────────────────────────────────── */}
        <div className="st-group">
          <div className="st-group-head">
            <span className="st-group-mark"><Server size={15}/></span>
            <div className="st-group-title">
              <h2>Gateway</h2>
              <p>Requests routed through Devora, and the catalogue behind them.</p>
            </div>
          </div>

          {/* Two headline figures, then the supporting ones. Requests and tokens are what a
              visitor came for; models and providers say the catalogue behind them is real. */}
          <div className="st-hero">
            <div className="st-headline">
              <span className="st-label">Requests served</span>
              <strong>{formatCounter(data.requests)}</strong>
              {data.requests >= 1000 && <small>{full(data.requests)} in total</small>}
            </div>
            <div className="st-headline">
              <span className="st-label">Tokens processed</span>
              <strong>{formatCounter(data.totalTokens)}</strong>
              {data.totalTokens >= 1000 && <small>{full(data.totalTokens)} across input and output</small>}
            </div>
          </div>

          <div className="st-grid">
            <div className="st-cell">
              <div className="st-cell-top"><Layers size={15}/><span>Models</span></div>
              <strong>{full(data.models)}</strong>
              <small>Published and ready</small>
            </div>
            <div className="st-cell">
              <div className="st-cell-top"><Boxes size={15}/><span>Providers</span></div>
              <strong>{full(data.providers)}</strong>
              <small>Behind one endpoint</small>
            </div>
            {/* Not an input/output ratio. Real traffic is ~99.9% prompt, so the ratio
                rounds to 100/0 and reads as broken rather than as the fact it is. Models
                called is the more useful figure and needs no rounding to stay honest. */}
            <div className="st-cell">
              <div className="st-cell-top"><Zap size={15}/><span>Models called</span></div>
              <strong>{full(data.modelsUsed)}</strong>
              <small>{data.modelsUsed > 0 ? `of ${full(data.models)} published` : "None yet"}</small>
            </div>
            <div className="st-cell">
              <div className="st-cell-top"><Server size={15}/><span>Events running</span></div>
              <strong>{full(data.activeEvents)}</strong>
              <small>{data.activeEvents > 0 ? "See what is on" : "Nothing running right now"}</small>
            </div>
          </div>

          {/* The window the figures cover. Honest about being a lifetime total rather than a
              rolling one, because "180 requests" without a period is ambiguous. */}
          {(data.firstRequestAt || data.lastRequestAt) && <p className="st-window">
            {data.firstRequestAt && <>Counting since <b>{shortDate(data.firstRequestAt)}</b></>}
            {data.firstRequestAt && data.lastRequestAt && " · "}
            {data.lastRequestAt && <>last request <b>{shortDate(data.lastRequestAt)}</b></>}
          </p>}
        </div>

        {/* ── Recent requests ──────────────────────────────────────────────────── */}
        {/* Sits directly under Gateway because it is the same subject — what the gateway is
            serving — read at a different grain: the lifetime figures above, the last ten
            calls here. A future endpoint group goes below this, not above it, so the page
            keeps running general → specific. */}
        {data.recentRequests.length > 0 && <div className="st-group">
          <div className="st-group-head">
            <span className="st-group-mark"><Activity size={15}/></span>
            <div className="st-group-title">
              <h2>Recent requests</h2>
              <p>The last ten calls through the gateway, newest first.</p>
            </div>
            {/* The live indicator belongs to the section it describes. Seconds are always
                shown, so this reads as running even when the last call was hours ago. */}
            <span className="st-live" title={`Page clock ${clk.day} ${clk.hms} · feed re-read every 15s while visible`}>
              <i className="st-live-dot"/>
              <span className="st-live-clock">{clk.hms}</span>
              <span className="st-live-label">live</span>
            </span>
          </div>
          <ul className="st-feed">
            {data.recentRequests.map((r, i) => <li key={`${r.at}-${i}`}
                className={i === 0 ? "st-feed-card st-feed-newest" : "st-feed-card"}>
              <div className="st-feed-top">
                <span className={r.status >= 200 && r.status < 300 ? "st-feed-status" : "st-feed-status st-feed-status-bad"}>
                  {r.status}
                </span>
                <span className="st-feed-route"><code>{r.endpoint}</code></span>
                {/* Hundredths read from the timestamp, so they move when a new call lands
                    and sit still otherwise — decoration that is also true. */}
                <span className="st-feed-sub">{subSeconds(r.at).slice(9)}</span>
              </div>
              <div className="st-feed-mid">
                {/* Only chat-shaped endpoints address a model, so a null here is a real
                    state and not missing data — it says this call route has no model to
                    name. */
                }
                {r.model
                  ? <><ProviderMark provider={r.model.provider ?? ""} size={22}/><span className="st-feed-name">{r.model.name ?? "Removed model"}</span></>
                  : <><span className="st-feed-nomark"><Activity size={14}/></span><span className="st-feed-name st-feed-name-muted">No model on this route</span></>}
              </div>
              <div className="st-feed-bot">
                <time className="st-feed-when" dateTime={r.at} title={whenFull(r.at)}>
                  {feedStamp(r.at).day} · {feedStamp(r.at).time}
                </time>
                <span className="st-feed-age">{ageShort(r.at, now)} ago</span>
              </div>
            </li>)}
          </ul>
        </div>}

        {/* ── Traffic by model ─────────────────────────────────────────────────── */}
        {data.modelBreakdown.length > 0 && <div className="st-group">
          <div className="st-group-head">
            <span className="st-group-mark"><Layers size={15}/></span>
            <div className="st-group-title">
              <h2>Traffic by model</h2>
              <p>Lifetime tokens routed. Heaviest first.</p>
            </div>
          </div>

          {/* Cards rather than a table. The reader is looking at one model at a time and
              asking what it accounts for, not comparing a column of figures — and each card
              carries its own labels, so nothing has to be repeated per screenful. The share
              bar is the one comparison that matters and it reads at a glance. */}
          <ul className="st-model-list">
            {data.modelBreakdown.map(m => {
              const share = data.totalTokens > 0 ? (m.totalTokens / data.totalTokens) * 100 : 0;
              return <li key={m.id} className="st-model-card">
                <div className="st-model-head">
                  {m.provider
                    ? <ProviderMark provider={m.provider}/>
                    : <span className="st-model-fallback"><Layers size={15}/></span>}
                  <div className="st-model-id">
                    {/* Falls back to the raw id when the model left the catalogue: its
                        traffic is still in the totals, so hiding the card would make the
                        breakdown not add up. */}
                    <strong>{m.name ?? m.id.replace(/^devora-\d+\//, "")}</strong>
                    <small><code>{m.id}</code></small>
                  </div>
                  <span className="st-model-share">{share >= 0.1 ? `${share.toFixed(1)}%` : "<0.1%"}</span>
                </div>

                <div className="st-model-bar" role="presentation">
                  <span style={{ width: `${Math.max(share, 1)}%` }}/>
                </div>

                <div className="st-model-facts">
                  <div><span>Requests</span><b>{full(m.requests)}</b></div>
                  <div><span>Tokens</span><b>{full(m.totalTokens)}</b></div>
                  {/* State of the model, on the figures line and pushed right — beside its
                      numbers rather than interrupting its name. Three states, kept apart on
                      purpose: a disabled model still exists and can be switched back on, a
                      deleted one cannot. Collapsing both into "unavailable" would hide the
                      only thing worth knowing — whether the traffic can resume. */}
                  {m.status === "inactive"
                    ? <span className="st-badge st-badge-off">inactive</span>
                    : !m.name
                      ? <span className="st-badge st-badge-gone">removed</span>
                      : null}
                </div>
              </li>;
            })}
          </ul>
        </div>}

        <p className="st-note">
          Totals are lifetime and are kept as a running snapshot, so they survive log pruning.
          Per-account figures are not published.
        </p>
      </>}
    </section>

    <footer className="landing-footer">
      <Brand/>
      <p>One platform. More ways to build.</p>
      <span className="landing-footer-copy">© 2026 Devora</span>
    </footer>
  </main>;
}
