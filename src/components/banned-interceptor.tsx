"use client";

import { useEffect } from "react";

/**
 * Global banned-account interceptor.
 *
 * Monkey-patches window.fetch so that any 403 response with the
 * `account_banned` error code triggers a redirect to /banned.
 * This catches every backend API call without modifying each page.
 */
let bannedInterceptorInstalled = false;

export function useBannedInterceptor() {
  useEffect(() => {
    if (bannedInterceptorInstalled) return;
    bannedInterceptorInstalled = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const response = await originalFetch.apply(this, args);
      if (response.status === 403) {
        try {
          const cloned = response.clone();
          const body = await cloned.json();
          if (body?.error?.code === "account_banned") {
            window.location.href = "/banned";
          }
        } catch {
          // Not JSON or other error — ignore
        }
      }
      return response;
    };
  }, []);
}
