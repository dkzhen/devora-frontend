"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { BarChart3, Coins, Flame, Gauge, Layers, Menu, Package, ReceiptText, Sparkles, Tag, Users, Waypoints, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatCredits } from "@/lib/credits";
import { ConsoleSignOutButton } from "@/components/console-sign-out";
import { CLERK_ENABLED } from "@/lib/clerk-config";

const nav = [
  { group: "MAIN", items: [{ href: "/console/billing", label: "Billing", icon: ReceiptText }, { href: "/console/credits", label: "Credits", icon: Coins }, { href: "/console/vouchers", label: "Vouchers", icon: Tag }] },
  { group: "SERVICES", items: [{ href: "/console/ai", label: "AI", icon: Waypoints }] },
];

/** Operator-only group. Mounted only for a SUPERUSER plan — the real gate is server-side. */
const adminNav = { group: "ADMIN", items: [
  { href: "/console/admin/events", label: "Events", icon: Flame },
  { href: "/console/admin/packages", label: "Packages", icon: Package },
  { href: "/console/admin/rate-limits", label: "Rate limits", icon: Gauge },
  { href: "/console/admin/models", label: "Models", icon: Layers },
  { href: "/console/admin/users", label: "Users", icon: Users },
  { href: "/console/admin/usage", label: "Usage", icon: BarChart3 },
] };

/**
 * The account card that sits above Sign out. Name comes from Clerk (no round trip
 * needed); plan and credits come from the Devora database via /api/v1/users/me,
 * which is the authority for both.
 */
function AccountCard({ name, initials, plan, credits, subs }: { name: string; initials: string; plan: string; credits: string; subs: SubscriptionInfo[] }) {
  const privileged = plan === "SUPERUSER";
  return <div className="account-card">
    <div className="account-identity"><span className="account-avatar">{initials}</span><div className="account-names"><strong>{name}</strong><small>{privileged ? <span className="plan-badge plan-privileged">{plan}</span> : plan}</small></div></div>
    <div className="account-credits"><span className="account-credits-label"><Coins size={14}/> Credits</span><strong>{formatCredits(credits)}</strong></div>
    <SubscriptionBadge subs={subs}/>
  </div>;
}

function ConfiguredAccountCard({ plan, credits, subs }: { plan: string | null; credits: string; subs: SubscriptionInfo[] }) {
  const { user } = useUser();
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.primaryEmailAddress?.emailAddress || "Account" : "Account";
  const initials = user ? [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || name.slice(0, 2).toUpperCase() : "A";
  const metadataPlan = user?.publicMetadata?.plan;
  const fallbackPlan = typeof metadataPlan === "string" && metadataPlan.trim() ? metadataPlan.trim().toUpperCase() : "STANDARD";
  return <AccountCard name={name} initials={initials} plan={plan ?? fallbackPlan} credits={credits} subs={subs}/>;
}

function AccountCardFallback() {
  return <AccountCard name="Account" initials="A" plan="STANDARD" credits="0" subs={[]}/>;
}

type SubscriptionInfo = {
  id: string; packageId: string; name: string; category: "hard_cap" | "unlimited";
  tier: string; expiresAt: string | null; tokensUsed: string;
  tokenCap: string | null; fairUseCap: string | null;
  baseRpm: number | null; throttledRpm: number | null; modelCount: number;
};

/** K/M/B compacting for a token count the sidebar reports. */
function tokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`;
  return String(n);
}

function daysLeft(iso: string | null): string {
  if (iso === null) return "lifetime";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  const d = Math.ceil(ms / 86_400_000);
  return d <= 0 ? "expired" : d === 1 ? "1 day left" : `${d} days left`;
}

/**
 * The plan allowance the account is currently on, shown under the credits figure. A subscription
 * is what the account *bought* — the credits number above it is separate and still spendable
 * (for models the package does not cover). Renders nothing when there is no live subscription,
 * so the card is not padded with an empty state.
 */
function SubscriptionBadge({ subs }: { subs: SubscriptionInfo[] }) {
  if (subs.length === 0) return null;
  return <div className="account-subs">
    {subs.map(s => {
      const granted = s.category === "unlimited" ? s.fairUseCap : s.tokenCap;
      const used = Number(s.tokensUsed);
      const cap = granted ? Number(granted) : null;
      // Unlimited never fills; it shows consumption against the fair-use mark instead.
      const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : null;
      const throttled = s.category === "unlimited" && cap !== null && used >= cap;
      return <div key={s.id} className="account-sub">
        <div className="account-sub-top">
          <span className="account-sub-name"><Sparkles size={12}/> {s.name}</span>
          <span className={throttled ? "account-sub-state account-sub-state-warn" : "account-sub-state"}>
            {s.category === "unlimited"
              ? (throttled ? `throttled ${s.throttledRpm ?? ""} rpm` : "unlimited")
              : "hard cap"}
          </span>
        </div>
        <div className="account-sub-meta">
          <span>{cap === null ? `${tokens(used)} used` : `${tokens(used)} / ${tokens(cap)}`}</span>
          <span>·</span>
          <span>{daysLeft(s.expiresAt)}</span>
        </div>
        {pct !== null && <div className="account-sub-bar"><i style={{ width: `${pct}%` }} /></div>}
      </div>;
    })}
  </div>;
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const [open, setOpen] = useState(false);
  // Resolved once for the whole shell so the nav and the account card agree, and
  // so the ADMIN group appears in the same render as the SUPERUSER badge.
  const { getToken } = useAuth();
  const [account, setAccount] = useState<{ plan: string | null; credits: string; subs: SubscriptionInfo[] }>({ plan: null, credits: "0", subs: [] });

  useEffect(() => {
    if (!CLERK_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json() as { user?: { plan?: string; credits?: unknown }; subscriptions?: SubscriptionInfo[] };
        if (cancelled) return;
        setAccount({
          plan: data.user?.plan ?? null,
          credits: typeof data.user?.credits === "string" ? data.user.credits : "0",
          subs: Array.isArray(data.subscriptions) ? data.subscriptions : [],
        });
      } catch {
        // Leave the defaults; the console stays usable without a plan.
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  const groups = account.plan === "SUPERUSER" ? [...nav, adminNav] : nav;

  return <div className="console-wrap">
    {open && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <nav aria-label="Console navigation" className="side-nav">
        {groups.map(group => <section key={group.group} className="nav-group"><div className="nav-label">{group.group}</div>{group.items.map(item => {const Icon=item.icon; const active=pathname===item.href; return <Link key={item.href} href={item.href} onClick={()=>setOpen(false)} className={`nav-link ${active?"nav-active":""}`} aria-current={active?"page":undefined}><Icon size={17}/>{item.label}</Link>;})}</section>)}
      </nav>
      <div className="sidebar-bottom">
        {CLERK_ENABLED ? <ConfiguredAccountCard plan={account.plan} credits={account.credits} subs={account.subs}/> : <AccountCardFallback/>}
        <ConsoleSignOutButton/>
      </div>
    </aside>
    <main className="console-main"><header className="console-topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Console</span><span>/</span><strong>{pathname.split("/").at(-1)?.replace("-"," ")}</strong></div><div className="topbar-right"></div></header><div className="console-content">{children}<footer className="console-footer"></footer></div></main>
  </div>;
}
