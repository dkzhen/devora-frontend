import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { CLERK_ENABLED } from "@/lib/clerk-config";

const CONSOLE_PATH = "/console";
const ADMIN_PATH = "/console/admin";
const AUTH_PATH = "/auth";
const BILLING_PATH = "/console/billing";

/** Where the frontend reaches the Devora backend. Server-side only. */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8787";

/**
 * Server-side plan check for the operator area.
 *
 * This is the check that actually denies access. Hiding the nav group is only
 * cosmetic — anyone who knows the path reaches this. The plan is read from the
 * Devora database (via the backend that owns it), never from Clerk metadata or
 * from anything the request carries.
 *
 * Fails closed: if the backend cannot be reached, the answer is "not an operator"
 * rather than an accidental grant.
 */
async function isSuperuser(getToken: () => Promise<string | null>): Promise<boolean> {
  try {
    const token = await getToken();
    if (!token) return false;
    const res = await fetch(`${BACKEND_ORIGIN}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = await res.json() as { user?: { plan?: string } };
    return data.user?.plan === "SUPERUSER";
  } catch {
    return false;
  }
}

export default clerkMiddleware(async (auth, request) => {
  if (!CLERK_ENABLED) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  // Clerk handshake loop guard: when the session token expires and the refresh
  // token is gone, Clerk repeatedly redirects to /__clerk/v1/client/handshake.
  // Intercept both the explicit failure reason and Clerk's redirect counter before
  // the browser spins. The old cookie names alone are not enough for Clerk v7;
  // the current SDK uses __clerk_handshake*, __clerk_redirect_count, etc.
  const hsReason = request.nextUrl.searchParams.get("__clerk_hs_reason") ?? "";
  const redirectCount = Number(request.cookies.get("__clerk_redirect_count")?.value ?? "0");
  const isHandshake = pathname.startsWith("/__clerk/") || pathname.includes("/handshake");
  const handshakeFailed = hsReason.includes("refresh_token_not_found") || hsReason.includes("expired");
  if (isHandshake && (handshakeFailed || redirectCount >= 2)) {
    const signInUrl = new URL(AUTH_PATH, request.url);
    // Never carry Clerk's handshake URL into `next`. Prefer its redirect target,
    // but keep only same-origin paths and fall back to the console home.
    const candidate = request.nextUrl.searchParams.get("redirect_url")
      ?? request.nextUrl.searchParams.get("__clerk_redirect_url")
      ?? BILLING_PATH;
    try {
      const target = new URL(candidate, request.url);
      signInUrl.searchParams.set("next", target.origin === request.nextUrl.origin
        ? `${target.pathname}${target.search}${target.hash}` : BILLING_PATH);
    } catch {
      signInUrl.searchParams.set("next", BILLING_PATH);
    }
    const res = NextResponse.redirect(signInUrl);
    // Nuke every current Clerk state cookie, including v7 names, so the auth
    // page starts a genuinely fresh session rather than reusing stale state.
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("__clerk")) res.cookies.delete(cookie.name);
    }
    return res;
  }

  const session = await auth();
  const { userId } = session;

  if (pathname === AUTH_PATH) {
    return userId
      ? NextResponse.redirect(new URL(BILLING_PATH, request.url))
      : NextResponse.next();
  }

  if (pathname === CONSOLE_PATH || pathname.startsWith(`${CONSOLE_PATH}/`)) {
    if (!userId) {
      const signInUrl = new URL(AUTH_PATH, request.url);
      signInUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(signInUrl);
    }

    // Signed in: the admin subtree needs an operator plan on top of the session.
    if (pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`)) {
      if (await isSuperuser(() => session.getToken())) return NextResponse.next();
      // A plain 404, matching an unknown route: the operator area should not be
      // discoverable by probing for a different response than "not found".
      return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
    }

    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  // No runtime export: Next 16 always runs the Proxy file on Node.js, which is what
  // the server-side plan lookup needs. Declaring it is a build error.
  matcher: [
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
