"use client";

import { useBannedInterceptor } from "@/components/banned-interceptor";

/** Wraps protected pages with the banned-account interceptor. */
export function Protected({ children }: { children: React.ReactNode }) {
  useBannedInterceptor();
  return <>{children}</>;
}
