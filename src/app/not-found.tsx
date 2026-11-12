import Link from "next/link";
import { Home } from "lucide-react";
import { LandingNav } from "@/components/landing-nav";

export default function NotFound() {
  return (
    <>
      <LandingNav />
      <main className="not-found-page">
        <div className="not-found-card">
          <span className="not-found-code">404</span>
          <h1>Page not found</h1>
          <p>The page you are looking for doesn&apos;t exist or has been moved.</p>
          <Link href="/" className="button button-ink compact-button">
            <Home size={15} /> Back to home
          </Link>
        </div>
      </main>
    </>
  );
}
