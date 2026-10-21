"use client";

import { LandingNav } from "@/components/landing-nav";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Brain, Eye, Gauge, Key, Layers, Loader2, Ruler, Search, Wrench, X, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { PublicFooter } from "@/components/public-footer";
import { ProviderMark } from "@/components/provider-mark";
import { PriceTag, pct, showPct } from "@/components/price-tag";
import { Select } from "@/components/select";
import { formatContext } from "@/lib/tokens";

/* The public catalogue page.

   Split from the landing sections on purpose. The landing page shows a highlight — three
   models and a link — because a table of forty rows reads as an inventory dump and buries
   the fact that a model is cheap. This page is where someone who already wants the detail
   goes: every model, provider marks, search, filters and sort. */

/* shared types */

type PublicModel = {
  id: string;
  name: string;
  provider: string | null;
  contextLength: number | null;
  accessPlans: string[];
  free: boolean;
  capabilities: { vision: boolean; reasoning: boolean; tools: boolean };
  pricing: { unit: string; input: string; output: string; originalInput: string | null; originalOutput: string | null };
};

/** One fetch of the public catalogue, shared by both the highlight and the full table. */
function useCatalogue() {
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
  return { models, status, reload: load };
}

/**
 * Whether a price should read as "free" rather than as a number.
 *
 * Two different things produce a zero: a model priced at 0 in the catalogue, and a model an
 * event is giving away. To a reader they are the same offer, so the card says the same word.
 * Printing "0 / 1M" for a free model looked like missing data, not like a gift.
 */
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

/* ================================================================== public /models page */

type SortKey = "price" | "context" | "name";

export function ModelsPage() {
  const { models, status, reload } = useCatalogue();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("price");

  // Providers present in the catalogue, for the filter row. Derived rather than hardcoded so
  // a new provider appears the moment a model using it is published.
  const providers = useMemo(() => {
    const seen = new Set<string>();
    for (const m of models) if (m.provider) seen.add(m.provider);
    return [...seen].sort();
  }, [models]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = models.filter(m => {
      if (provider !== "all" && m.provider !== provider) return false;
      if (!q) return true;
      // Search across every field a visitor might know the model by, including the id — people
      // often paste the id from a config file rather than typing the display name.
      return [m.name, m.id, m.provider ?? "", ...capabilityChips(m)].join(" ").toLowerCase().includes(q);
    });
    const sorted = [...filtered];
    if (sort === "price") sorted.sort((a, b) => {
        const aFree = a.free || (Number(a.pricing.input) === 0 && Number(a.pricing.output) === 0);
        const bFree = b.free || (Number(b.pricing.input) === 0 && Number(b.pricing.output) === 0);
        if (aFree !== bFree) return aFree ? -1 : 1;
        return Number(a.pricing.input) - Number(b.pricing.input);
      });
    else if (sort === "context") sorted.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
    else sorted.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    return sorted;
  }, [models, query, provider, sort]);

  return <main className="landing events-landing">
    <LandingNav/>

    <section className="mp-head">
      <div className="section-tag"><Layers size={13}/> CATALOGUE</div>
      <h1>Models</h1>
      <p>Everything the workspace serves, with live prices. One key, one balance, no minimum spend.</p>
    </section>

    <section className="mp-body">
      {/* Toolbar: search is the primary control, so it gets the width; the two selects sit
          beside it and stack under it on a phone. */}
      <div className="mp-toolbar">
        <label className="mp-search">
          <Search size={16}/>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search models, providers, capabilities…"
            aria-label="Search models"
          />
          {query && <button type="button" className="mp-search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}
        </label>
        {/* Provider is a dropdown, not a row of chips. Chips do not survive a catalogue with
            twenty providers — the row wraps to two lines and pushes the list off-screen. A
            select stays one control however many options it holds. Sort stays visible as
            buttons because it is three fixed choices and the current one should be readable
            without opening anything. */}
        <div className="mp-filters">
          <div className="mp-group">
            <span className="mp-group-label">Provider</span>
            <Select
              label="Filter by provider"
              value={provider}
              onChange={setProvider}
              width={168}
              options={[{ value: "all", label: `All providers (${models.length})` },
                        ...providers.map(p => ({ value: p, label: `${p} (${models.filter(m => m.provider === p).length})` }))]}
            />
          </div>
          <div className="mp-group" role="group" aria-label="Sort order">
            <span className="mp-group-label">Sort</span>
            <div className="mp-sorts">
              {([["price", "Cheapest"], ["context", "Largest"], ["name", "A–Z"]] as [SortKey, string][]).map(([k, label]) =>
                <button key={k} type="button" className={sort === k ? "mp-sort mp-sort-on" : "mp-sort"} onClick={() => setSort(k)}>{label}</button>)}
            </div>
          </div>
        </div>
      </div>

      <div className="mp-count">
        {status === "ready" && <><strong>{visible.length}</strong> of {models.length} model{models.length === 1 ? "" : "s"}{query && <> matching “{query}”</>}</>}
      </div>

      {status === "loading" && <div className="land-pricing-state"><Loader2 size={20} className="row-spinner"/><strong>Loading the catalogue…</strong></div>}
      {status === "error" && <div className="land-pricing-state"><Zap size={20}/><strong>Could not load the catalogue</strong><button className="button button-outline compact-button" type="button" onClick={() => void reload()}>Try again</button></div>}
      {status === "ready" && visible.length === 0 && <div className="land-pricing-state">
        <Gauge size={20}/><strong>Nothing matches</strong>
        <p>{models.length === 0 ? "No models are published yet." : "Try a different word, or clear the filters."}</p>
      </div>}

      {status === "ready" && visible.length > 0 && <div className="mp-list">
        {visible.map(m => {
          // Two prices, one promotion. `saving` is the larger of the two discounts, so the badge
          // says "up to" rather than naming a figure that is only true on one of the lines.
          const di = pct(m.pricing.originalInput, m.pricing.input);
          const dou = pct(m.pricing.originalOutput, m.pricing.output);
          // Plans beyond the default every model grants. Empty means the model is open to all, in
          // which case there is no restriction to report.
          const restricted = m.accessPlans.filter(p => p !== "STANDARD");
          const both = [di, dou].filter((v): v is number => v !== null);
          const saving = both.length === 0 ? null : Math.max(...both);
          return <article key={m.id} className={m.free ? "mp-item mp-item-free" : "mp-item"}>
          {/* Identity first: the provider mark, the name, and the id a caller copies into a
              config. Everything after this block is a property of those three. */}
          <div className="mp-item-head">
            {m.provider ? <ProviderMark provider={m.provider} size={30}/> : <span className="provider-fallback" style={{ width: 30, height: 30 }}>?</span>}
            <div className="mp-item-id">
              <strong>{m.name || m.id}</strong>
              <code>{m.id}</code>
            </div>
            <div className="mp-item-badges">
              {/* Top-right, text only. A discount is a standing property of the model, so it sits
                  with the other labels rather than floating on the card — and no box, because a
                  boxed badge competes with the price for the same glance, and the price sells.
                  The figure is the larger of the two sides; a "up to" was tried and dropped, since
                  a range on a label this small is more words than the label can carry. */}
              {!m.free && saving !== null && <b className="mp-off">{showPct(saving)}</b>}
              {m.free && <b className="land-free-pill">EVENT</b>}
              {/* The access badge moved to the foot of the card, beside the capabilities, where
                  the two halves of "what can it do / who can use it" sit opposite each other. It
                  is not repeated here — one statement of access, not two. */}
            </div>
          </div>

          {/* The numbers, each with the icon that says what it is — a label would repeat the
              word already implied and cost a line on every row.
              A free model is an *event*, not a zero price, so the catalogue price stays
              visible struck through beside the word "free" — it shows what the model costs
              once the event ends, and reads as a saving rather than as missing data. */}
          <dl className="mp-item-facts">
            <div>
              <dt><ArrowDownToLine size={13}/> Input</dt>
              <dd><PriceTag price={{ value: m.pricing.input, original: m.pricing.originalInput, free: isFreePrice(m, m.pricing.input) }}/></dd>
            </div>
            <div>
              <dt><ArrowUpFromLine size={13}/> Output</dt>
              <dd><PriceTag price={{ value: m.pricing.output, original: m.pricing.originalOutput, free: isFreePrice(m, m.pricing.output) }}/></dd>
            </div>
            <div>
              <dt><Ruler size={13}/> Context</dt>
              <dd>{m.contextLength ? <>{formatContext(m.contextLength)}<small>tokens</small></> : "—"}</dd>
            </div>

            {/* Capabilities take the third slot when the model is open to every plan, and the
                fourth when it is not — so the row of facts is filled either way and nothing is
                ever left dangling at the end of it. */}
            {restricted.length === 0 && capabilityChips(m).length > 0 && <div className="mp-facts-wide">
              <dt>Capabilities</dt>
              <dd>
                <span className="mp-caps-row">
                  {m.capabilities.vision && <span className="mp-cap" role="img" aria-label="Vision" title="Vision"><Eye size={12}/></span>}
                  {m.capabilities.reasoning && <span className="mp-cap" role="img" aria-label="Reasoning" title="Reasoning"><Brain size={12}/></span>}
                  {m.capabilities.tools && <span className="mp-cap" role="img" aria-label="Tools" title="Tools"><Wrench size={12}/></span>}
                </span>
              </dd>
            </div>}

            {/* Access is its own fact, so it sits in the grid rather than on a row beneath it.
                Without this the facts row held two prices and a context figure, and the pair that
                answers "what can it do / who can use it" hung underneath, unrelated to them. */}
            {restricted.length > 0 && <div>
              <dt>Restricted</dt>
              <dd>
                <span className="mp-caps-row">
                  {restricted.map(plan => <span key={plan} className="mp-plan-text">{plan}</span>)}
                </span>
              </dd>
            </div>}

            {restricted.length > 0 && capabilityChips(m).length > 0 && <div className="mp-facts-wide">
              <dt>Capabilities</dt>
              <dd>
                <span className="mp-caps-row">
                  {m.capabilities.vision && <span className="mp-cap" role="img" aria-label="Vision" title="Vision"><Eye size={12}/></span>}
                  {m.capabilities.reasoning && <span className="mp-cap" role="img" aria-label="Reasoning" title="Reasoning"><Brain size={12}/></span>}
                  {m.capabilities.tools && <span className="mp-cap" role="img" aria-label="Tools" title="Tools"><Wrench size={12}/></span>}
                </span>
              </dd>
            </div>}

          </dl>        </article>;
        })}
      </div>}

      <p className="mp-note">
        Credits per 1M tokens, read live from the catalogue. An <b>EVENT</b> badge means
        the model is free to call until the event ends.
      </p>
    </section>

    <PublicFooter/>
  </main>;
}
