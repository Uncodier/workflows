import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure we do a server build (not static export). API routes require server runtime.
  output: "standalone"
};

export default nextConfig;
