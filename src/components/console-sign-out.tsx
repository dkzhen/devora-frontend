"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { CLERK_ENABLED } from "@/lib/clerk-config";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";

function ConfiguredSignOutButton() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSignOut = async () => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await signOut({ redirectUrl: "/" });
      router.push("/");
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return <button type="button" onClick={() => void handleSignOut()} className="sidebar-signout" aria-label="Sign out" aria-busy={pending} disabled={pending}>
    {pending ? <><Loader2 size={16} className="signout-spinner"/><span>Signing out…</span></> : <><LogOut size={16}/><span>{failed ? "Retry sign out" : "Sign out"}</span></>}
  </button>;
}

export function ConsoleSignOutButton() {
  if (!CLERK_ENABLED) return <span className="auth-config-hint">Sign-out unavailable</span>;
  return <ConfiguredSignOutButton/>;
}
