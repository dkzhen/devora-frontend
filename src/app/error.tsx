"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { LandingNav } from "@/components/landing-nav";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <LandingNav />
      <main className="not-found-page">
        <div className="not-found-card">
          <AlertTriangle size={40} style={{ color: "var(--coral, #d02020)", marginBottom: 12 }} />
          <h1>Something went wrong</h1>
          <p>{error.message || "An unexpected error occurred while loading this page."}</p>
          <button
            className="button button-ink compact-button"
            type="button"
            onClick={reset}
          >
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      </main>
    </>
  );
}
