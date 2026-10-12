"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { CLERK_ENABLED, CLERK_PUBLISHABLE_KEY } from "@/lib/clerk-config";

export function AppClerkProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) return <>{children}</>;

  return <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>{children}</ClerkProvider>;
}
