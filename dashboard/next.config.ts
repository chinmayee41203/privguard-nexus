import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard lives in a subfolder of the action's repo; keep Turbopack scoped to it.
  turbopack: { root: __dirname },
};

export default nextConfig;
