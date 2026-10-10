import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @saf/core is consumed from TypeScript source (its package exports point at src/index.ts).
  transpilePackages: ["@saf/core"],
  experimental: {
    // @saf/core imports its own modules as "./x.js" (ESM style) while the files are "./x.ts". Only webpack can
    // map that (Turbopack has no extensionAlias), which is why `dev` and `build` run with --webpack.
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default nextConfig;
