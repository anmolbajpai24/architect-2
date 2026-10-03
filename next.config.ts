import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WASM/data files at runtime; keep it out of the server bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
