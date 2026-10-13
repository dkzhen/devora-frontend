"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Brain, Eye, Gauge, Key, Layers, Loader2, Ruler, Search, Wrench, X, Zap } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { ProviderMark } from "@/components/provider-mark";
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
  pricing: { unit: string; input: string; output: string };
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
    if (sort === "price") sorted.sort((a, b) => Number(a.pricing.input) - Number(b.pricing.input));
    else if (sort === "context") sorted.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
    else sorted.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    return sorted;
  }, [models, query, provider, sort]);

  return <main className="landing events-landing">
    <nav className="landing-nav">
      <Brand/>
      <div className="landing-links"><Link href="/#why">Why Devora</Link><Link href="/#how">How it works</Link><Link href="/events">Events</Link><Link href="/pricing">Plans</Link></div>
      <PrimaryLink href="/console/billing">Open console</PrimaryLink>
    </nav>

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
        {visible.map(m => <article key={m.id} className={m.free ? "mp-item mp-item-free" : "mp-item"}>
          {/* Identity first: the provider mark, the name, and the id a caller copies into a
              config. Everything after this block is a property of those three. */}
          <div className="mp-item-head">
            {m.provider ? <ProviderMark provider={m.provider} size={30}/> : <span className="provider-fallback" style={{ width: 30, height: 30 }}>?</span>}
            <div className="mp-item-id">
              <strong>{m.name || m.id}</strong>
              <code>{m.id}</code>
            </div>
            <div className="mp-item-badges">
              {m.free && <b className="land-free-pill">EVENT</b>}
              {/* Only the plans that are not universal. STANDARD is the default every model
                  grants, so a STANDARD badge on every card says nothing and reads as clutter;
                  SUBSCRIPTION is the one that changes who can call the model. No icon — the
                  word is already the whole message. */}
              {m.accessPlans.filter(plan => plan !== "STANDARD").map(plan =>
                <b key={plan} className="mp-plan">{plan}</b>)}
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
              <dd>{isFreePrice(m, m.pricing.input)
                ? <span className="mp-was-free"><em>free</em>{Number(m.pricing.input) > 0 && <><del>{m.pricing.input}</del><small>/ 1M</small></>}</span>
                : <>{m.pricing.input}<small>/ 1M</small></>}</dd>
            </div>
            <div>
              <dt><ArrowUpFromLine size={13}/> Output</dt>
              <dd>{isFreePrice(m, m.pricing.output)
                ? <span className="mp-was-free"><em>free</em>{Number(m.pricing.output) > 0 && <><del>{m.pricing.output}</del><small>/ 1M</small></>}</span>
                : <>{m.pricing.output}<small>/ 1M</small></>}</dd>
            </div>
            <div>
              <dt><Ruler size={13}/> Context</dt>
              <dd>{m.contextLength ? <>{formatContext(m.contextLength)}<small>tokens</small></> : "—"}</dd>
            </div>
          </dl>

          {capabilityChips(m).length > 0 && <div className="mp-item-caps">
            {m.capabilities.vision && <span><Eye size={13}/> Vision</span>}
            {m.capabilities.reasoning && <span><Brain size={13}/> Reasoning</span>}
            {m.capabilities.tools && <span><Wrench size={13}/> Tools</span>}
          </div>}
        </article>)}
      </div>}

      <p className="mp-note">
        Credits per 1M tokens, read live from the catalogue. An <b>EVENT</b> badge means
        the model is free to call until the event ends.
      </p>
    </section>

    <footer className="landing-footer">
      <Brand/>
      <p>One platform. More ways to build.</p>
      <span className="landing-footer-copy">© 2026 Devora</span>
    </footer>
  </main>;
}
