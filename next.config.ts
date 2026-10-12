import type { NextConfig } from "next";

/**
 * Backend origin for server-side rewrites. Defaults to the local dev backend;
 * set BACKEND_ORIGIN in the deploy environment.
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.8.103", "127.0.0.1", "localhost"],
  // Same-origin proxy to the Devora backend. The console therefore calls
  // `/backend/...` instead of a hardcoded host, which keeps LAN access working
  // (the browser would resolve a literal 127.0.0.1 to the visitor's machine) and
  // avoids cross-origin requests entirely.
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${BACKEND_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
