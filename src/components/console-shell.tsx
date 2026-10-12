"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { BarChart3, Coins, Flame, Gauge, Layers, Menu, ReceiptText, Tag, Users, Waypoints, X } from "lucide-react";
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
function AccountCard({ name, initials, plan, credits }: { name: string; initials: string; plan: string; credits: string }) {
  const privileged = plan === "SUPERUSER";
  return <div className="account-card">
    <div className="account-identity"><span className="account-avatar">{initials}</span><div className="account-names"><strong>{name}</strong><small>{privileged ? <span className="plan-badge plan-privileged">{plan}</span> : plan}</small></div></div>
    <div className="account-credits"><span className="account-credits-label"><Coins size={14}/> Credits</span><strong>{formatCredits(credits)}</strong></div>
  </div>;
}

function ConfiguredAccountCard({ plan, credits }: { plan: string | null; credits: string }) {
  const { user } = useUser();
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.primaryEmailAddress?.emailAddress || "Account" : "Account";
  const initials = user ? [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || name.slice(0, 2).toUpperCase() : "A";
  const metadataPlan = user?.publicMetadata?.plan;
  const fallbackPlan = typeof metadataPlan === "string" && metadataPlan.trim() ? metadataPlan.trim().toUpperCase() : "STANDARD";
  return <AccountCard name={name} initials={initials} plan={plan ?? fallbackPlan} credits={credits}/>;
}

function AccountCardFallback() {
  return <AccountCard name="Account" initials="A" plan="STANDARD" credits="0"/>;
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const [open, setOpen] = useState(false);
  // Resolved once for the whole shell so the nav and the account card agree, and
  // so the ADMIN group appears in the same render as the SUPERUSER badge.
  const { getToken } = useAuth();
  const [account, setAccount] = useState<{ plan: string | null; credits: string }>({ plan: null, credits: "0" });

  useEffect(() => {
    if (!CLERK_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/backend/api/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json() as { user?: { plan?: string; credits?: unknown } };
        if (cancelled) return;
        setAccount({
          plan: data.user?.plan ?? null,
          credits: typeof data.user?.credits === "string" ? data.user.credits : "0",
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
        {CLERK_ENABLED ? <ConfiguredAccountCard plan={account.plan} credits={account.credits}/> : <AccountCardFallback/>}
        <ConsoleSignOutButton/>
      </div>
    </aside>
    <main className="console-main"><header className="console-topbar"><button className="icon-button menu-toggle" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Console</span><span>/</span><strong>{pathname.split("/").at(-1)?.replace("-"," ")}</strong></div><div className="topbar-right"></div></header><div className="console-content">{children}<footer className="console-footer"></footer></div></main>
  </div>;
}
