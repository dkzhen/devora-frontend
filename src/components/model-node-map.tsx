"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Server } from "lucide-react";
import { ProviderMark } from "@/components/provider-mark";

/**
 * Where a package's models actually run, grouped by node.
 *
 * A model id carries its node as the first path segment (`devora-01/agnes/agnes-1-demo` sits on
 * node 1), and each node is served by a different upstream account. Grouping the same list by
 * node answers the question the flat list cannot: *if this node is down, which models do I lose,
 * and what am I really getting for the price* — two models that look interchangeable in the chip
 * list can sit on completely different upstreams.
 *
 * Collapsed by default: it is context, not the headline, and the model list below it is what
 * most readers came for.
 */

export type NodeModel = { id?: string | null; name: string; provider?: string | null };

/** The node is the segment before the first slash. Models with no prefix are grouped as "—". */
function nodeOf(id?: string | null): string {
  if (!id) return "unassigned";
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : "unassigned";
}

type NodeGroup = {
  node: string;
  count: number;
  /** Models on this node, ordered by provider then name so the provider marks group visually
   *  without a provider row repeating the name. */
  models: NodeModel[];
};

export function ModelNodeMap({ models, label = "Node layout" }: { models: NodeModel[]; label?: string }) {
  const [open, setOpen] = useState(false);
  // Per-node "show all" flag. A node with 22 models made the card 800px tall inside a modal
  // that is capped at 620px, which pushed the actual model list below the fold — the card
  // exists to give context, not to become the content.
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const MAX_ROWS = 6;

  const groups = useMemo<NodeGroup[]>(() => {
    const byNode = new Map<string, NodeModel[]>();
    for (const m of models) {
      const key = nodeOf(m.id);
      const list = byNode.get(key);
      if (list) list.push(m);
      else byNode.set(key, [m]);
    }
    return [...byNode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([node, list]) => ({
        node,
        count: list.length,
        models: [...list].sort((a, b) =>
          (a.provider ?? "").localeCompare(b.provider ?? "") || a.name.localeCompare(b.name)),
      }));
  }, [models]);

  if (models.length === 0) return null;

  return (
    <div className={open ? "node-map node-map-open" : "node-map"}>
      <button
        type="button"
        className="node-map-head"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Server size={15}/>
        <span className="node-map-title">{label}</span>
        <span className="node-map-summary">
          {groups.length} {groups.length === 1 ? "node" : "nodes"} · {models.length} models
        </span>
        <ChevronDown size={16} className={open ? "node-map-chevron node-map-chevron-open" : "node-map-chevron"}/>
      </button>

      {open && (
        <div className="node-map-body">
          {groups.map(g => (
            <section className="node-group" key={g.node}>
              <header className="node-group-head">
                <code>{g.node === "unassigned" ? "no node prefix" : g.node}</code>
                <span className="node-group-count">{g.count} models</span>
              </header>
              {/* Timeline, not a table: one dot per model, joined by a vertical rule, so the
                  node reads as "these all live on one upstream" without a provider column
                  repeating the same word six times. The provider is the dot's logo; its name
                  and the model id stay in the tooltip. */}
              <ol className="node-timeline">
                {(expandedNodes[g.node] ? g.models : g.models.slice(0, MAX_ROWS)).map(m => (
                  <li className="node-step" key={m.id ?? m.name}>
                    <span className="node-step-dot">
                      <ProviderMark provider={m.provider ?? ""} size={13}/>
                    </span>
                    <span className="node-step-label" title={`${m.provider ?? "unknown"} — ${m.id ?? m.name}`}>
                      {m.name}
                    </span>
                  </li>
                ))}
              </ol>
              {g.models.length > MAX_ROWS && (
                <button
                  type="button"
                  className="node-more"
                  aria-expanded={expandedNodes[g.node] === true}
                  onClick={() => setExpandedNodes(prev => ({ ...prev, [g.node]: !prev[g.node] }))}
                >
                  {expandedNodes[g.node]
                    ? "Show less"
                    : `Show all ${g.models.length} models (+${g.models.length - MAX_ROWS})`}
                </button>
              )}
            </section>
          ))}
          <p className="node-map-note">
            Models on the same node share one upstream account, so an outage there affects that
            group together. A package covering several nodes keeps working when one of them fails.
          </p>
        </div>
      )}
    </div>
  );
}
