import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server build (not static export). Standalone disabled to avoid pages-manifest requirement.
  // Narrow ESLint scope and optionally bypass during builds to avoid hangs
  eslint: {
    ignoreDuringBuilds: true,
    dirs: ["src"],
  },
  typescript: {
    // Do not ignore type errors; we want them to fail the build once unstuck
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
