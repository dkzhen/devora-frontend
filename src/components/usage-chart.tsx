"use client";

import { useEffect, useState, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatCounter } from "@/lib/format-counter";

type DailyPoint = { date: string; requests: number; tokens: number };

function formatTokenShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Smooth count-up number that animates from previous to new value. */
function CountUp({ value, animateKey }: { value: number; animateKey: number }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    const duration = 1200;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // easeOutExpo for a premium feel
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = Math.round(start + (end - start) * eased);
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = end;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, animateKey]);

  return <span className="countup-num">{display.toLocaleString("en-US")}</span>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload?: { date?: string; tokens?: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p?.date) return null;
  const d = new Date(p.date);
  const isToday = p.date === new Date().toISOString().slice(0, 10);
  return (
    <div className="lu-tooltip">
      <div className="lu-tooltip-date">
        {isToday ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
      </div>
      <div className="lu-tooltip-value">{formatCounter(p.tokens ?? 0)} <span>tokens</span></div>
    </div>
  );
}

type TopModel = { id: string; name: string; provider: string | null; requests: number; tokens: number };

function TopModelsToday() {
  const [models, setModels] = useState<TopModel[]>([]);
  const [totalModels, setTotalModels] = useState(0);

  useEffect(() => {
    fetch("/backend/api/v1/stats/top-models-today", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((data: { models?: TopModel[]; totalModels?: number } | null) => {
        if (!data) return;
        setModels(data.models ?? []);
        setTotalModels(data.totalModels ?? 0);
      })
      .catch(() => {});
  }, []);

  if (models.length === 0) return null;

  return (
    <div className="lu-models-list">
      {models.map((m, i) => (
        <div key={m.id} className="lu-model-row">
          <span className="lu-model-rank">{i + 1}</span>
          <span className="lu-model-name">{m.name}</span>
          <span className="lu-model-tokens">{formatTokenShort(m.tokens)}</span>
        </div>
      ))}
      {totalModels > models.length && (
        <a href="/models" className="lu-model-more">+{totalModels - models.length} more models →</a>
      )}
    </div>
  );
}

export function UsageChart() {
  const [data, setData] = useState<DailyPoint[] | null>(null);
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [prevTokens, setPrevTokens] = useState<number | null>(null);
  const [totalRequests, setTotalRequests] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  // Initial load + daily chart
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/backend/api/v1/stats/daily", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
      fetch("/backend/api/v1/stats", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
    ]).then(([daily, stats]) => {
      if (!alive) return;
      if (daily?.days) {
        const all = daily.days as DailyPoint[];
        const last7: DailyPoint[] = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const ds = d.toISOString().slice(0, 10);
          const found = all.find(x => x.date === ds);
          last7.push(found ?? { date: ds, requests: 0, tokens: 0 });
        }
        setData(last7);
      }
      if (stats) {
        setTotalTokens(stats.totalTokens ?? null);
        setTotalRequests(stats.requests ?? null);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Live polling — fetch real total from BE every 3s once visible.
  // Cache-busting timestamp prevents stale responses at any layer.
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      fetch(`/backend/api/v1/stats?_t=${Date.now()}`, { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then((stats: { totalTokens?: number; requests?: number } | null) => {
          if (!stats) return;
          setTotalTokens(stats.totalTokens ?? null);
          setTotalRequests(stats.requests ?? null);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [visible]);

  // Animate odometer when section scrolls into view
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Kill recharts default focus ring — the SVG surface gets tabindex=0 which
  // creates a black outline when clicked. Remove it after render.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const surface = el.querySelector(".recharts-surface");
    if (surface) surface.removeAttribute("tabindex");
    const wrapper = el.querySelector(".recharts-wrapper");
    if (wrapper) wrapper.removeAttribute("tabindex");
  });

  if (!data || data.length === 0) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayData = data.find(d => d.date === todayStr);
  const todayTokens = todayData?.tokens ?? 0;
  const weekTotal = data.reduce((sum, d) => sum + d.tokens, 0);

  const chartData = data.map(d => ({
    date: d.date,
    tokens: d.tokens,
    isToday: d.date === todayStr,
    label: new Date(d.date).toLocaleDateString(undefined, { weekday: "short" }),
  }));

  const animateKey = (visible ? 1 : 0) + (totalTokens ?? 0);

  return (
    <section className="live-usage-section" ref={sectionRef}>
      <div className="lu-card">
        {/* Receipt-style top tear */}
        <svg className="lu-tear" width="100%" height="8" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="tear-devora" width="14" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 8 L7 0 L14 8 Z" fill="#f5f1e8" />
            </pattern>
          </defs>
          <rect width="100%" height="8" fill="url(#tear-devora)" />
        </svg>

        <div className="lu-inner">
          {/* Header */}
          <div className="lu-head">
            <span className="lu-brand">DEVORA</span>
            <span className="lu-live"><span className="lu-live-dot" />LIVE</span>
          </div>
          <div className="lu-divider" />

          {/* Total tokens — odometer */}
          <div className="lu-total-block">
            <div className="lu-total-cap">tokens processed</div>
            <div className="lu-total-num">
              {totalTokens !== null ? <CountUp value={totalTokens} animateKey={animateKey} /> : <span className="odo-placeholder">—</span>}
            </div>
          </div>

          {/* Chart */}
          <div className="lu-chart-area" role="img" aria-label="7-day token usage chart">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
                <defs>
                  <linearGradient id="barToday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1a9d8e" />
                    <stop offset="100%" stopColor="#147060" />
                  </linearGradient>
                  <linearGradient id="barNormal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4ebe7" />
                    <stop offset="100%" stopColor="#c0d8d3" />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#a09a8e", fontFamily: "var(--body)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(23,117,107,0.05)" }} />
                <Bar dataKey="tokens" radius={[4, 4, 0, 0]} maxBarSize={48} animationDuration={900}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.isToday ? "url(#barToday)" : "url(#barNormal)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Divider */}
          <div className="lu-divider" />

          {/* Top models today */}
          <div className="lu-top-models">
            <div className="lu-top-models-cap">TOP MODELS TODAY</div>
            <TopModelsToday />
          </div>

          {/* Footer */}
          <div className="lu-foot">
            <div className="lu-legend">
              <span className="lu-leg-dot lu-leg-today" /> Today
              <span className="lu-leg-dot lu-leg-past" /> Previous days
            </div>
            <span className="lu-foot-updated">{visible ? "Updated just now" : ""}</span>
          </div>
        </div>

        {/* Receipt-style bottom tear */}
        <svg className="lu-tear lu-tear-bottom" width="100%" height="8" aria-hidden="true" focusable="false">
          <rect width="100%" height="8" fill="url(#tear-devora)" />
        </svg>
      </div>
    </section>
  );
}
