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
  // Disable Turbopack completely for production builds to avoid root inference bugs
};

export default nextConfig;
