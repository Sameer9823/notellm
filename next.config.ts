import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "jsdom", "@mozilla/readability", "node-webvtt"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  devIndicators: false,
};

export default nextConfig;
