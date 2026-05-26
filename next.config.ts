import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server build (not static export). Standalone disabled to avoid pages-manifest requirement.
  // Narrow ESLint scope and optionally bypass during builds to avoid hangs
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Do not ignore type errors; we want them to fail the build once unstuck
    ignoreBuildErrors: false,
  },
  turbopack: {
    // Empty config allows turbopack to run with default settings
  },
};

export default nextConfig;
