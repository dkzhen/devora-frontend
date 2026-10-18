"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, KeyRound, Loader2, Layers, Lock, Search, Server, ShieldCheck, Timer, TrendingUp, Wrench, X, Zap, RefreshCw } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { ProviderMark } from "@/components/provider-mark";
import { Modal } from "@/components/modal";
import { formatPrice } from "@/lib/credits";
import { CLERK_ENABLED } from "@/lib/clerk-config";

type Credentials = { apiKey: string; baseUrl: string; plan: string };

/** What the console may see. Upstream ids are internal and never sent here. */
type CatalogueModel = {
  id: string;
  displayName: string;
  provider: string;
  contextLength: number | null;
  node: string | null;
  priceInputCredits: number;
  priceOriginalInput: number | null;
  priceOriginalOutput: number | null;
  priceOutputCredits: number;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
  accessPlans: string[];
  /** True when a running event covers this model — price becomes zero. */
  free?: boolean;
};

/**
 * The short form of a catalogue id, for a narrow column.
 *
 * Ids repeat the vendor — `deepseek/deepseek-v4.1-flash` — because the upstream name does,
 * and the full string is too wide to read in a table on a phone. The last path segment
 * keeps everything that distinguishes one model from another; the untruncated id stays on
 * the element's `title`, so nothing is lost, only deferred.
 */
function shortModel(id: string): string {
  const last = id.split("/").filter(Boolean).pop();
  return last ?? id;
}

/**
 * How many models the breakdown shows before collapsing the rest behind a toggle.
 *
 * Chosen so the section stays a summary: at the narrowest layout each row is about two
 * lines, so this keeps the preview inside roughly one screen.
 */
const MODELS_PREVIEW = 5;

/** How many model cards to render per page before paginating. */
const MODEL_PAGE_SIZE = 12;

/**
 * Which page buttons to render: a window around the current page, plus the first and last.
 * Copied from the credits page so both paginations behave the same way.
 */
function pageWindow(current: number, total: number, span = 1): (number | "gap")[] {
  if (total <= span * 2 + 5) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, current - span);
  const to = Math.min(total - 1, current + span);
  if (from > 2) out.push("gap");
  for (let n = from; n <= to; n++) out.push(n);
  if (to < total - 1) out.push("gap");
  out.push(total);
  return out;
}

/** Compact context length: 1000000 -> "1M", 262144 -> "262K". */
function formatContext(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${Math.round(n / 100_000) / 10}M`;
}

/**
 * All-time figures for the signed-in account, read from the backend's stored totals.
 *
 * These are totals, not a window: they do not shrink when request history is cleared,
 * because the backend keeps them in a separate table.
 */
type UsageSummary = {
  scope: "all";
  requests: number;
  errors: number;
  interrupted: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  chargedCredits: string;
  firstRequestAt: string | null;
  lastRequestAt: string | null;
  models: {
    model: string;
    requests: number;
    errors: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    chargedCredits: string;
    lastRequestAt: string;
  }[];
};

/** Group digits the way the rest of the console does; locale-free so output is stable. */
function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Compact token volume for the stat tiles: 1_234_567 -> "1.2M". */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Drop trailing zeros from a credit string: "1.200000" -> "1.2". */
function trimCredits(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A request counter with correct singular/plural. "1 requests" is the kind of detail that
 * makes a page feel unfinished.
 */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Per-section load state so a failure renders where the data belongs. */
type Status = "loading" | "ready" | "error";

/** Turn a failed response into something a person can act on. */
function reasonFor(status: number): string {
  if (status === 401) return "Your session expired — sign in again.";
  if (status === 403) return "This account cannot use the gateway.";
  if (status === 503) return "The gateway is not configured on the server.";
  if (status === 502) return "The upstream gateway is unreachable.";
  return "The gateway did not respond.";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
    }
    setDone(true); window.setTimeout(() => setDone(false), 1800);
  };
  return <button className="button button-outline compact-button" onClick={copy}>{done ? <Check size={15}/> : <Copy size={15}/>} {done ? "Copied" : label}</button>;
}

/** Inline status for a row: a spinner while loading, an explanation + retry on failure. */
function RowState({ status, message, onRetry }: { status: Status; message: string; onRetry: () => void }) {
  if (status === "loading") {
    return <span className="row-state"><Loader2 size={15} className="row-spinner"/> Loading…</span>;
  }
  if (status === "error") {
    return <span className="row-state row-state-error"><X size={14}/><span>{message}</span><button type="button" className="row-retry" onClick={onRetry}>Retry</button></span>;
  }
  return null;
}

export default function AIPage() {
  const { getToken } = useAuth();
  const [visible, setVisible] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [credStatus, setCredStatus] = useState<Status>("loading");
  const [credError, setCredError] = useState("");
  const [test, setTest] = useState<"idle" | "testing" | "success" | "failed">("idle");
  // Rotation state. Kept separate from credStatus so the key stays visible while the
  // confirm dialog is open — only the button reflects the in-flight request.
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState("");
  const [rotated, setRotated] = useState(false);

  // Credentials come from the backend that owns them, so rotating the upstream key
  // never needs a frontend deploy. useCallback so a failed load can be retried in
  // place instead of forcing a page reload.
  const loadCredentials = useCallback(async () => {
    if (!CLERK_ENABLED) {
      setCredStatus("error");
      setCredError("Sign-in is not configured for this deployment.");
      return;
    }
    setCredStatus("loading");
    try {
      const token = await getToken();
      if (!token) {
        setCredStatus("error");
        setCredError("Sign in to see your gateway credentials.");
        return;
      }
      const res = await fetch("/backend/api/v1/ai/credentials", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setCredStatus("error");
        setCredError(reasonFor(res.status));
        return;
      }
      const data = await res.json() as Credentials;
      setCredentials({ apiKey: data.apiKey, baseUrl: data.baseUrl, plan: data.plan ?? "STANDARD" });
      setCredStatus("ready");
      setCredError("");
    } catch {
      setCredStatus("error");
      setCredError("Could not reach the gateway.");
    }
  }, [getToken]);

  /**
   * Replace the key. The old value stops working immediately, so the dialog says so
   * before the request goes out rather than after.
   *
   * On success the new key is shown straight away and the reveal state is reset to
   * hidden — the value would otherwise be left on screen from the previous key, which
   * reads as if nothing changed.
   */
  const rotateKey = useCallback(async () => {
    if (!CLERK_ENABLED) return;
    setRotating(true);
    setRotateError("");
    try {
      const token = await getToken();
      if (!token) {
        setRotateError("Your session expired. Sign in again.");
        return;
      }
      const res = await fetch("/backend/api/v1/ai/credentials/rotate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setRotateError(reasonFor(res.status));
        return;
      }
      const data = await res.json() as Credentials;
      setCredentials({ apiKey: data.apiKey, baseUrl: data.baseUrl, plan: data.plan ?? "STANDARD" });
      setVisible(false);
      setRotated(true);
      setRotateOpen(false);
      setTest("idle");   // the old key was the one under test
    } catch {
      setRotateError("Could not reach the gateway.");
    } finally {
      setRotating(false);
    }
  }, [getToken]);

  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<Status>("loading");
  const [modelsError, setModelsError] = useState("");
  const [query, setQuery] = useState("");
  const [modelPage, setModelPage] = useState(1);

  const loadModels = useCallback(async () => {
    setModelsStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/ai/models", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        setModelsError(reasonFor(res.status));
        setModelsStatus("error");
        return;
      }
      const data = await res.json() as { models?: unknown };
      const rows = Array.isArray(data.models) ? data.models as CatalogueModel[] : [];
      setModels(rows.map(row => ({
        ...row,
        provider: String(row.provider ?? ""),
        contextLength: typeof row.contextLength === "number" ? row.contextLength : null,
        node: row.node ?? null,
        supportsVision: row.supportsVision === true,
        supportsReasoning: row.supportsReasoning === true,
        supportsTools: row.supportsTools === true,
        accessPlans: Array.isArray(row.accessPlans) ? row.accessPlans : [],
      })));
      setModelsStatus("ready");
    } catch {
      setModelsError("Could not reach the gateway.");
      setModelsStatus("error");
    }
  }, [getToken]);

  useEffect(() => { void loadModels(); }, [loadModels]);

  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageStatus, setUsageStatus] = useState<Status>("loading");
  const [usageError, setUsageError] = useState("");
  /**
   * The per-model list is a summary under the tiles, not the page's subject. Its length is
   * bounded by the catalogue rather than by traffic — one row per model — but a catalogue
   * with dozens of entries would still turn the section into a long scroll. The first few
   * rows are shown by default and the rest are one click away.
   */
  const [allModels, setAllModels] = useState(false);

  const loadUsage = useCallback(async () => {
    setUsageStatus("loading");
    try {
      const token = await getToken();
      const res = await fetch("/backend/api/v1/ai/usage", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) {
        setUsageError(reasonFor(res.status));
        setUsageStatus("error");
        return;
      }
      setUsage(await res.json() as UsageSummary);
      setUsageStatus("ready");
    } catch {
      setUsageError("Could not reach the gateway.");
      setUsageStatus("error");
    }
  }, [getToken]);

  useEffect(() => { void loadUsage(); }, [loadUsage]);

  /**
   * Filter across the fields a person actually searches by: the name they read and
   * the id they copy into a client. Capabilities are searched by keyword too, so
   * "vision" finds every model that takes images.
   */
  const needle = query.trim().toLowerCase();
  const visibleModels = (needle === ""
    ? models
    : models.filter(m => {
        const haystack = [
          m.displayName,
          m.id,
          m.node ?? "",
          m.supportsVision ? "vision image" : "",
          m.supportsReasoning ? "reasoning thinking" : "",
          m.supportsTools ? "tools toolcall function" : "",
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      })
    ).sort((a, b) => {
      // Free models first (event or zero-price), then cheapest, then alphabetical
      const aFree = a.free === true || (a.priceInputCredits === 0 && a.priceOutputCredits === 0);
      const bFree = b.free === true || (b.priceInputCredits === 0 && b.priceOutputCredits === 0);
      if (aFree !== bFree) return aFree ? -1 : 1;
      if (!aFree) {
        const aPrice = a.priceInputCredits + a.priceOutputCredits;
        const bPrice = b.priceInputCredits + b.priceOutputCredits;
        if (aPrice !== bPrice) return aPrice - bPrice;
      }
      return a.displayName.localeCompare(b.displayName);
    });

  // Reset to the first page whenever the search query changes, so results always start fresh.
  useEffect(() => { setModelPage(1); }, [needle]);

  const modelPageCount = Math.max(1, Math.ceil(visibleModels.length / MODEL_PAGE_SIZE));
  const pagedModels = visibleModels.slice((modelPage - 1) * MODEL_PAGE_SIZE, modelPage * MODEL_PAGE_SIZE);


  useEffect(() => { void loadCredentials(); }, [loadCredentials]);

  // Real request through this proxy using the caller's own gateway key, so a green
  // result means the whole path works — not that a timeout resolved.
  const testConnection = async () => {
    setTest("testing");
    try {
      const res = await fetch("/backend/v1/models", {
        headers: credentials ? { Authorization: `Bearer ${credentials.apiKey}` } : undefined,
      });
      setTest(res.ok ? "success" : "failed");
    } catch {
      setTest("failed");
    }
  };

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><Activity size={14}/> SERVICES / AI GATEWAY</div><h1>AI Gateway</h1><p>One base URL for the models you use to build.</p></div></div>

    <section className="console-section base-section"><div className="section-title-row"><div><span className="section-index">01</span><div><h2>Base URL</h2><p>Use this base URL in your AI client configuration.</p></div></div><button className="button button-outline compact-button" onClick={testConnection} disabled={credStatus !== "ready" || test === "testing"}><Zap size={15}/>{test === "testing" ? "Testing…" : test === "success" ? "Connected" : test === "failed" ? "Failed" : "Test connection"}</button></div><div className="base-url-row">{credStatus === "ready" && credentials ? <><code>{credentials.baseUrl}</code><CopyButton text={credentials.baseUrl}/></> : <RowState status={credStatus} message={credError} onRetry={() => void loadCredentials()}/>}</div>{test === "success" && <p className="success-line" role="status"><Check size={14}/> Connection successful.</p>}{test === "failed" && <p className="success-line row-fail" role="status"><X size={14}/> Could not reach the gateway.</p>}</section>

    <section className="console-section usage-section"><div className="section-title-row"><div><span className="section-index">02</span><div><h2>Usage</h2><p>All-time request activity for this account.</p></div></div><span className="period-badge">All time</span></div>{usageStatus === "loading" && <div className="usage-loading"><Loader2 size={16} className="spin"/> Loading usage…</div>}{usageStatus === "error" && <p className="success-line row-fail" role="status"><X size={14}/> {usageError}</p>}{usageStatus === "ready" && usage && <><div className="usage-grid"><article className="usage-stat"><div className="stat-top"><span>Requests</span><Activity size={16}/></div><strong>{formatCount(usage.requests)}</strong><small><TrendingUp size={13}/> <span>{usage.requests === 0 ? "no requests yet" : `${plural(usage.errors, "error")}${usage.interrupted > 0 ? `, ${plural(usage.interrupted, "interrupted")}` : ""}`}</span></small></article><article className="usage-stat"><div className="stat-top"><span>Tokens</span><Zap size={16}/></div><strong>{formatTokens(usage.totalTokens)}</strong><small><TrendingUp size={13}/> <span>{`${formatTokens(usage.promptTokens)} in · ${formatTokens(usage.completionTokens)} out`}</span></small></article><article className="usage-stat"><div className="stat-top"><span>Credits used</span><span className="cost-icon">◈</span></div><strong>{trimCredits(usage.chargedCredits)}</strong><small><Timer size={13}/> {usage.lastRequestAt ? `last used ${new Date(usage.lastRequestAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "never used"}</small></article></div>{usage.models.length > 0 && <div className="usage-breakdown"><div className="breakdown-head"><span>Model</span><span>Requests</span><span>Tokens</span><span>Credits</span></div>{(allModels ? usage.models : usage.models.slice(0, MODELS_PREVIEW)).map(m => <div className="breakdown-row" key={m.model}><span className="breakdown-model" title={m.model}>{shortModel(m.model)}</span><span data-label="Requests">{formatCount(m.requests)}{m.errors > 0 && <em className="breakdown-errors">{m.errors} failed</em>}</span><span data-label="Tokens">{formatTokens(m.totalTokens)}</span><span data-label="Credits">{trimCredits(m.chargedCredits)}</span></div>)}{usage.models.length > MODELS_PREVIEW && <button className="breakdown-more" onClick={() => setAllModels(v => !v)}>{allModels ? `Show fewer` : `Show all ${formatCount(usage.models.length)} models`}</button>}</div>}</>}</section>

    <section className="console-section keys-section"><div className="section-title-row"><div><span className="section-index">03</span><div><h2>API Keys</h2><p>Manage the keys your clients use to authenticate.</p></div></div><div className="key-label"><ShieldCheck size={15}/> <span className="key-label-text">KEEP SECRET</span></div></div><div className="key-card"><div className="key-card-info"><div className="key-icon"><KeyRound size={17}/></div><div><strong>Devora gateway key</strong><small>One key per account</small></div></div><div className="key-value">{credStatus === "ready" && credentials ? <><code>{visible ? credentials.apiKey : `${credentials.apiKey.slice(0, 10)}${"•".repeat(24)}`}</code><button className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide key" : "Reveal key"}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button><CopyButton text={credentials.apiKey} label="Copy key"/></> : <RowState status={credStatus} message={credError} onRetry={() => void loadCredentials()}/>}</div><div className="key-rotate"><button className="button button-outline" type="button" onClick={() => { setRotateError(""); setRotateOpen(true); }} disabled={credStatus !== "ready" || !credentials}><RefreshCw size={14}/> Rotate key</button><small>Issues a new key and revokes this one immediately.</small></div></div>{rotated && <p className="key-rotated-note"><Check size={14}/> New key issued. Anything still using the old one now gets 401.</p>}</section>

    <section className="console-section models-section"><div className="section-title-row models-heading"><div><span className="section-index">04</span><div><h2>Models</h2><p>Models available to your workspace.</p></div></div><div className="models-toolbar"><label className="search-field"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search models…" aria-label="Search models"/></label>{modelsStatus === "ready" && <span className="model-count">{visibleModels.length} of {models.length}</span>}</div></div>
        {modelsStatus === "loading" && <div className="table-empty"><Loader2 size={19} className="row-spinner"/><strong>Loading models…</strong><p>Reading the catalogue.</p></div>}
        {modelsStatus === "error" && <div className="table-empty"><X size={19}/><strong>Could not load models</strong><p>{modelsError}</p><button type="button" className="button button-outline compact-button" onClick={() => void loadModels()}>Retry</button></div>}
        {modelsStatus === "ready" && (models.length === 0
          ? <div className="table-empty"><Layers size={19}/><strong>No models available</strong><p>Nothing has been published to your workspace yet.</p></div>
          : visibleModels.length === 0
          ? <div className="table-empty"><Search size={19}/><strong>No match for “{query.trim()}”</strong><p>Try a model name, an id, or a capability like “vision”.</p><button type="button" className="button button-outline compact-button" onClick={() => setQuery("")}>Clear search</button></div>
          : <div className="model-card-grid">{pagedModels.map(m => {
            const userPlan = credentials?.plan ?? "STANDARD";
            const isLocked = userPlan !== "SUPERUSER" && userPlan !== "SUBSCRIPTION" && !m.accessPlans.includes(userPlan);
            const hasInputDiscount = !m.free && m.priceOriginalInput !== null && m.priceOriginalInput > m.priceInputCredits;
            const hasOutputDiscount = !m.free && m.priceOriginalOutput !== null && m.priceOriginalOutput > m.priceOutputCredits;
            const maxDiscount = !m.free ? Math.max(
              hasInputDiscount ? Math.round((1 - m.priceInputCredits / (m.priceOriginalInput as number)) * 100) : 0,
              hasOutputDiscount ? Math.round((1 - m.priceOutputCredits / (m.priceOriginalOutput as number)) * 100) : 0,
            ) : 0;
            return <article className={`model-card${isLocked ? " model-card-locked" : ""}${m.free ? " model-card-event" : ""}`} key={m.id}>
              {isLocked && <div className="model-card-lock-overlay"><span className="model-card-lock-icon"><Lock size={20}/></span><span className="model-card-lock-text">Subscription<br/>required</span></div>}
              {m.free ? <span className="model-card-event-badge">Event</span> : maxDiscount > 0 && <span className="model-card-discount">{maxDiscount}% OFF</span>}
              <div className="model-card-head"><ProviderMark provider={m.provider}/><strong>{m.displayName}</strong></div>
              <code className="ref-chip model-card-id">{m.id}</code>
              <div className="model-card-pricing">
                <span className="price-pair">
                  <span className="price-in">
                    {m.free ? <><s>{formatPrice(m.priceInputCredits)}</s> Free</> : <>↓ {formatPrice(m.priceInputCredits)}{hasInputDiscount && <s className="price-strike">{formatPrice(m.priceOriginalInput as number)}</s>}</>}
                    <small className="price-unit">/ 1M</small>
                  </span>
                  <span className="price-out">
                    {m.free ? <><s>{formatPrice(m.priceOutputCredits)}</s> Free</> : <>↑ {formatPrice(m.priceOutputCredits)}{hasOutputDiscount && <s className="price-strike">{formatPrice(m.priceOriginalOutput as number)}</s>}</>}
                    <small className="price-unit">/ 1M</small>
                  </span>
                </span>
              </div>
              <div className="model-card-ctx">Context: {m.contextLength ? formatCount(m.contextLength) : "—"} tokens</div>
              <div className="model-card-foot">
                <span className="cap-list model-card-caps">
                  {m.supportsVision && <span className="cap-badge" title="Vision"><Eye size={12}/></span>}
                  {m.supportsReasoning && <span className="cap-badge" title="Reasoning"><Brain size={12}/></span>}
                  {m.supportsTools && <span className="cap-badge" title="Tool call"><Wrench size={12}/></span>}
                  {!m.supportsVision && !m.supportsReasoning && !m.supportsTools && <span className="cap-none">—</span>}
                </span>
                {m.node && <small className="model-card-node">node: {m.node}</small>}
                {isLocked ? <span className="model-card-lock-note"><Lock size={12}/> Subscription</span> : <CopyButton text={m.id} label="Copy ID"/>}
              </div>
            </article>;
          })}</div>)}
      {modelsStatus === "ready" && visibleModels.length > MODEL_PAGE_SIZE && <div className="pagination">
        <span className="pagination-summary">Showing {(modelPage - 1) * MODEL_PAGE_SIZE + 1}–{Math.min(modelPage * MODEL_PAGE_SIZE, visibleModels.length)} of {visibleModels.length}</span>
        <div className="pagination-controls">
          <button type="button" className="icon-button" aria-label="Previous page" disabled={modelPage === 1} onClick={() => setModelPage(p => Math.max(1, p - 1))}><ChevronLeft size={15}/></button>
          {pageWindow(modelPage, modelPageCount).map((n, i) => n === "gap"
            ? <span key={`gap-${i}`} className="page-gap" aria-hidden>…</span>
            : <button key={n} type="button" className={`page-number ${n === modelPage ? "page-current" : ""}`} aria-current={n === modelPage ? "page" : undefined} onClick={() => setModelPage(n)}>{n}</button>)}
          <button type="button" className="icon-button" aria-label="Next page" disabled={modelPage === modelPageCount} onClick={() => setModelPage(p => Math.min(modelPageCount, p + 1))}><ChevronRight size={15}/></button>
        </div>
      </div>}
      <div className="table-note"><Server size={14}/> Call these ids against your base URL — the gateway resolves the provider.</div></section>
  <Modal
    open={rotateOpen}
    tone="danger"
    title="Rotate gateway key?"
    subtitle="The current key stops working the moment you confirm."
    busy={rotating}
    onClose={() => { if (!rotating) { setRotateOpen(false); setRotateError(""); } }}
    footer={<>
      <button className="button button-outline" type="button" onClick={() => { setRotateOpen(false); setRotateError(""); }} disabled={rotating}>Cancel</button>
      <button className="button button-ink" type="button" onClick={() => void rotateKey()} disabled={rotating}>
        {rotating ? <><Loader2 size={14} className="row-spinner"/> Rotating…</> : <><RefreshCw size={14}/> Rotate key</>}
      </button>
    </>}
  >
    <p className="modal-hint">
      Any client still authenticating with the old key will start receiving 401 responses.
      Copy the new key from this page once it is issued — you will need to update every
      deployment that calls the gateway.
    </p>
    {rotateError && <p className="modal-warning">{rotateError}</p>}
  </Modal>

  </div>;
}
