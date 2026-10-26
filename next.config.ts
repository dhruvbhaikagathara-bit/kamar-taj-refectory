import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: false,
  allowedDevOrigins: ["10.212.125.13"],
};

export default nextConfig;