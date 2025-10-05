import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure we do a server build (not static export). API routes require server runtime.
  output: "standalone",
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
