import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Server build (not static export). Standalone disabled to avoid pages-manifest requirement.
  // Narrow ESLint scope and optionally bypass during builds to avoid hangs
  // eslint: { ignoreDuringBuilds: true } is now configured via environment variable in package.json
  typescript: {
    // Do not ignore type errors; we want them to fail the build once unstuck
    ignoreBuildErrors: false,
  },
  turbopack: {
    // Explicitly define the workspace root for Render environment
    root: path.join(__dirname),
  },
};

export default nextConfig;
