import type { NextConfig } from "next";

import { securityHeaders } from "./lib/http/security-headers";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Baseline security headers on every response (pages, Route Handlers, static files).
  // The Content Security Policy is per request with a nonce; see proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ production: process.env.NODE_ENV === "production" }),
      },
    ];
  },
};

export default nextConfig;
