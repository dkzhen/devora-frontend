"use client";

import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { parseBody, type Json } from "./body-parse";

/**
 * A JSON viewer for the request and response bodies.
 *
 * A raw `<pre>` was the obvious first answer and the wrong one: these bodies are one long
 * line, so the parts that matter — the messages, the role, the usage — are found by reading
 * a wall of text. Collapsible nodes with a compact summary turn a 300-character blob into
 * three lines a person can scan.
 *
 * A streamed response is not a JSON document at all: it is `data: {...}` frames separated by
 * blank lines. Parsing is delegated to `body-parse`, which recognises that shape and returns
 * the frames, so a streamed reply shows its chunks instead of "not valid JSON".
 */

type JsonObject = { [k: string]: Json };

function isObject(v: Json): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** One-line preview of a container, so a collapsed node still says what is inside. */
function summarize(value: Json): string {
  if (Array.isArray(value)) return value.length === 1 ? "[1 item]" : `[${value.length} items]`;
  if (!isObject(value)) return String(value);
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const shown = keys.slice(0, 3).join(", ");
  return `{ ${shown}${keys.length > 3 ? `, +${keys.length - 3}` : ""} }`;
}

function isLeaf(v: Json): boolean {
  return v === null || typeof v !== "object";
}

function Leaf({ value }: { value: Json }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === "boolean") return <span className="json-bool">{String(value)}</span>;
  if (typeof value === "number") return <span className="json-num">{value}</span>;
  if (typeof value !== "string") return null;
  return <span className="json-str">&quot;{value}&quot;</span>;
}

function Node({ name, value, depth, defaultOpen }: {
  name: string | null; value: Json; depth: number; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (isLeaf(value)) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 }}>
        {name !== null && <span className="json-key">{name}</span>}
        <Leaf value={value}/>
      </div>
    );
  }
  const entries: [string, Json][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as [string, Json])
    : Object.entries(value as JsonObject) as [string, Json][];
  return (
    <div className="json-node">
      <button type="button" className="json-toggle" style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
        {name !== null && <span className="json-key">{name}</span>}
        <span className="json-summary">{summarize(value)}</span>
      </button>
      {open && entries.map(([k, v]) => (
        <Node key={k} name={Array.isArray(value) ? `[${k}]` : k} value={v} depth={depth + 1} defaultOpen={depth < 1}/>
      ))}
    </div>
  );
}

export function JsonView({ source, label }: { source: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseBody(source), [source]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      // Clipboard needs a secure context; plain HTTP on a LAN is not one. Selecting the text
      // is a more useful fallback than doing nothing.
      const ta = document.createElement("textarea");
      ta.value = source;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* give up quietly */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [source]);

  return (
    <div className="json-view">
      <div className="json-bar">
        <span className="json-label">{label}</span>
        <button type="button" className="json-copy" onClick={() => void copy()}>
          {copied ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy raw</>}
        </button>
      </div>
      <div className="json-body">
        {parsed.shape === "json" && <Node name={null} value={parsed.value} depth={0} defaultOpen/>}
        {parsed.shape === "sse" && (
          <>
            {/* Labelled, not apologised for: a stream is the expected shape here, and saying
                "not valid JSON" would describe the viewer's limitation as the data's fault. */}
            <p className="json-note">{parsed.frames.length} stream frame(s) — Server-Sent Events, one JSON object per frame.</p>
            {parsed.frames.map((f, i) => (
              <Node key={i} name={`frame ${i + 1}`} value={f} depth={0} defaultOpen={false}/>
            ))}
          </>
        )}
        {parsed.shape === "text" && (
          <>
            <p className="json-note">Not JSON — shown as text.</p>
            <pre className="json-raw">{source}</pre>
          </>
        )}
      </div>
    </div>
  );
}
