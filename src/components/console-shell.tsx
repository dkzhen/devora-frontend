"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { BarChart3, Bell, Coins, CreditCard, Flame, Headset, Layers, Menu, Package, ReceiptText, Settings, Sparkles, Tag, UserCircle, Users, Wallet, Waypoints, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { formatCredits } from "@/lib/credits";
import { ConsoleSignOutButton } from "@/components/console-sign-out";
import { CLERK_ENABLED } from "@/lib/clerk-config";
import { Modal } from "@/components/modal";

const nav = [
  { group: "MAIN", items: [{ href: "/console/billing", label: "Billing", icon: ReceiptText }, { href: "/console/credits", label: "Credits", icon: Coins }, { href: "/console/vouchers", label: "Vouchers", icon: Tag }] },
  { group: "SERVICES", items: [{ href: "/console/ai", label: "AI", icon: Waypoints }] },
];

/** Operator-only groups. Mounted only for a SUPERUSER plan — the real gate is server-side. */
const adminNav = { group: "ADMIN", items: [
  { href: "/console/admin/transactions", label: "Transactions", icon: Wallet },
  { href: "/console/admin/payment", label: "Payment", icon: CreditCard },
  { href: "/console/admin/events", label: "Events", icon: Flame },
  { href: "/console/admin/packages", label: "Packages", icon: Package },
  { href: "/console/admin/models", label: "Models", icon: Layers },
  { href: "/console/admin/users", label: "Users", icon: Users },
  { href: "/console/admin/usage", label: "Usage", icon: BarChart3 },
  { href: "/console/admin/settings", label: "Settings", icon: Settings },
] };

/**
 * The account card that sits above Sign out. Name comes from Clerk (no round trip
 * needed); plan and credits come from the Devora database via /api/v1/users/me,
 * which is the authority for both.
 */
function AccountCard({ name, initials, plan, credits, subs, freeTokensUsed }: { name: string; initials: string; plan: string; credits: string; subs: SubscriptionInfo[]; freeTokensUsed?: number }) {
  const privileged = plan === "SUPERUSER";
  const showFree = plan !== "SUPERUSER" && plan !== "SUBSCRIPTION";
  const FREE_LIMIT = 20_000_000;
  const freeUsed = freeTokensUsed ?? 0;
  const freePct = showFree ? Math.min(100, Math.round((freeUsed / FREE_LIMIT) * 100)) : 0;
  return <div className="account-card">
    <div className="account-identity"><span className="account-avatar">{initials}</span><div className="account-names"><strong>{name}</strong><small>{privileged ? <span className="plan-badge plan-privileged">{plan}</span> : plan}</small></div></div>
    <div className="account-credits"><span className="account-credits-label"><Coins size={14}/> Credits</span><strong>{formatCredits(credits)}</strong></div>
    {showFree && <div className="account-free-tokens">
      <span className="account-free-tokens-label"><Sparkles size={12}/> Free tokens</span>
      <span className="account-free-tokens-value">{tokens(freeUsed)} / 20M</span>
      {freePct > 0 && <div className="account-sub-bar"><i style={{ width: `${freePct}%` }} /></div>}
    </div>}
    <SubscriptionBadge subs={subs}/>
  </div>;
}

function ConfiguredAccountCard({ plan, credits, subs, freeTokensUsed }: { plan: string | null; credits: string; subs: SubscriptionInfo[]; freeTokensUsed?: number }) {
  const { user } = useUser();
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.primaryEmailAddress?.emailAddress || "Account" : "Account";
  const initials = user ? [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || name.slice(0, 2).toUpperCase() : "A";
  const metadataPlan = user?.publicMetadata?.plan;
  const fallbackPlan = typeof metadataPlan === "string" && metadataPlan.trim() ? metadataPlan.trim().toUpperCase() : "STANDARD";
  return <AccountCard name={name} initials={initials} plan={plan ?? fallbackPlan} credits={credits} subs={subs} freeTokensUsed={freeTokensUsed}/>;
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
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return days === 1 ? "1 day left" : `${days} days left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return hours === 1 ? "1 hour left" : `${hours} hours left`;
  const mins = Math.floor(ms / 60_000);
  if (mins >= 1) return `${mins} min left`;
  return "< 1 min left";
}

/**
 * The plan allowance the account is currently on, shown under the credits figure. A subscription
 * is what the account *bought* — the credits number above it is separate and still spendable
 * (for models the package does not cover). Renders nothing when there is no live subscription,
 * so the card is not padded with an empty state.
 */
function SubscriptionBadge({ subs }: { subs: SubscriptionInfo[] }) {
  if (subs.length === 0) return null;
  const MAX_SHOW = 2;
  const shown = subs.slice(0, MAX_SHOW);
  const overflow = subs.length - MAX_SHOW;
  return <div className="account-subs">
    {shown.map(s => {
      const granted = s.category === "unlimited" ? s.fairUseCap : s.tokenCap;
      const used = Number(s.tokensUsed);
      const cap = granted ? Number(granted) : null;
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
    {overflow > 0 && <Link href="/console/billing" className="account-sub-more">+{overflow} more →</Link>}
  </div>;
}

type Notification = {
  id: string; title: string; message: string;
  severity: "info" | "warning" | "error"; createdAt: string; read: boolean;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const [open, setOpen] = useState(false);
  // Resolved once for the whole shell so the nav and the account card agree, and
  // so the ADMIN group appears in the same render as the SUPERUSER badge.
  const { getToken } = useAuth();
  const { user } = useUser();
  const [account, setAccount] = useState<{ plan: string | null; credits: string; subs: SubscriptionInfo[]; freeTokensUsed?: number }>({ plan: null, credits: "0", subs: [] });
  // Clerk may recreate getToken during auth-state updates. Keep the latest function
  // in a ref so shell data effects run once per mount, not on every render.
  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);

  useEffect(() => {
    if (!CLERK_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json() as { user?: { plan?: string; credits?: unknown; freeTokensUsed?: number }; subscriptions?: SubscriptionInfo[] };
        if (cancelled) return;
        setAccount({
          plan: data.user?.plan ?? null,
          credits: typeof data.user?.credits === "string" ? data.user.credits : "0",
          subs: Array.isArray(data.subscriptions) ? data.subscriptions : [],
          freeTokensUsed: typeof data.user?.freeTokensUsed === "number" ? data.user.freeTokensUsed : 0,
        });
      } catch {
        // Leave the defaults; the console stays usable without a plan.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // In-app notifications — poll every 30s for unread count.
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = async () => {
    if (!CLERK_ENABLED) return;
    try {
      const token = await getTokenRef.current();
      if (!token) return;
      const res = await fetch("/backend/api/v1/notifications", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json() as { notifications: Notification[]; unreadCount: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    if (!CLERK_ENABLED) return;
    void fetchNotifications();
    const timer = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(timer);
  }, []);

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch("/backend/api/v1/notifications/mark-all", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* non-fatal */ }
    finally { setMarkingAll(false); }
  };

  const accountLabel = "My Account";
  const groups = account.plan === "SUPERUSER" ? [...nav, { group: "ACCOUNTS", items: [{ href: "/console/account", label: accountLabel, icon: UserCircle }, { href: "/console/support", label: "Support", icon: Headset }] }, adminNav] : [...nav, { group: "ACCOUNTS", items: [{ href: "/console/account", label: accountLabel, icon: UserCircle }, { href: "/console/support", label: "Support", icon: Headset }] }];

  return <div className="console-wrap">
    {open && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <nav aria-label="Console navigation" className="side-nav">
        {groups.map(group => <section key={group.group} className="nav-group"><div className="nav-label">{group.group}</div>{group.items.map(item => {const Icon=item.icon; const active=pathname===item.href; return <Link key={item.href} href={item.href} onClick={()=>setOpen(false)} className={`nav-link ${active?"nav-active":""}`} aria-current={active?"page":undefined}><Icon size={17}/>{item.label}</Link>;})}</section>)}
      </nav>
      <div className="sidebar-bottom">
        {CLERK_ENABLED ? <ConfiguredAccountCard plan={account.plan} credits={account.credits} subs={account.subs} freeTokensUsed={account.freeTokensUsed}/> : <AccountCardFallback/>}
        <ConsoleSignOutButton/>
      </div>
    </aside>
    <main className="console-main"><header className="console-topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Console</span><span>/</span><strong>{pathname.split("/").at(-1)?.replace("-"," ")}</strong></div><div className="topbar-right">
          <button className="icon-button" aria-label="Notifications" style={{ position: "relative" }} onClick={() => setNotifOpen(true)}>
            <Bell size={19}/>
            {unreadCount > 0 && <span style={{ position: "absolute", top: -2, right: -2, background: "var(--mustard)", color: "var(--ink)", fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </button>
        </div></header><div className="console-content">{children}<footer className="console-footer"></footer></div></main>
    <Modal open={notifOpen} title="Notifications" busy={markingAll} onClose={() => setNotifOpen(false)} footer={<>
      <button type="button" className="button button-outline" onClick={() => setNotifOpen(false)}>Close</button>
      <button type="button" className="button button-ink" disabled={markingAll || unreadCount === 0} onClick={() => void markAllRead()}>{markingAll ? "Marking…" : "Mark all as read"}</button>
    </>}>
      {notifications.length === 0
        ? <p style={{ color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>No notifications.</p>
        : <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {notifications.map(n => (
              <div key={n.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--border)", opacity: n.read ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: n.severity === "error" ? "#c0392b" : n.severity === "warning" ? "var(--mustard)" : "#1a9d8e", boxShadow: n.severity === "error" ? "0 0 0 3px rgba(192,57,43,.18)" : n.severity === "warning" ? "0 0 0 3px rgba(255,197,49,.18)" : "0 0 0 3px rgba(26,157,142,.18)" }} />
                  <strong style={{ fontSize: "var(--fs-small)" }}>{n.title}</strong>
                  {!n.read && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink)", background: "var(--mustard)", padding: "1px 6px", borderRadius: 4 }}>NEW</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{timeAgo(n.createdAt)}</span>
                </div>
                <p style={{ fontSize: "var(--fs-small)", color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>{n.message}</p>
              </div>
            ))}
          </div>}
    </Modal>
  </div>;
}
