import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/marketing": ["./shopify/reef-marketing-custom-pixel.js"],
    "/api/marketing/black-friday-assets/*": ["./public/reef-black-friday/*"],
  },
};

export default nextConfig;
