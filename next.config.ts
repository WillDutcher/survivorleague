import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The rule engine and db layer are server-only; keep the driver out of bundles.
  serverExternalPackages: ["postgres"],
  typedRoutes: true,
};

export default nextConfig;
