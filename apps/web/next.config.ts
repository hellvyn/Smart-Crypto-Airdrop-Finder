import type { NextConfig } from "next";

// Sent on every response: no framing by other sites (clickjacking on the auth, wallet and settings forms), no full
// URLs leaked to other origins, and no MIME sniffing.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // @saf/core is consumed from TypeScript source (its package exports point at src/index.ts).
  transpilePackages: ["@saf/core"],
  experimental: {
    // @saf/core imports its own modules as "./x.js" (ESM style) while the files are "./x.ts". Only webpack can
    // map that (Turbopack has no extensionAlias), which is why `dev` and `build` run with --webpack.
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default nextConfig;
