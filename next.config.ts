import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/marketing": ["./shopify/reef-marketing-custom-pixel.js"],
  },
};

export default nextConfig;
