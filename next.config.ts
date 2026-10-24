import type { NextConfig } from "next";

function parseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("rediss://") ? raw.replace("rediss://", "https://") : raw);
    return u.origin;
  } catch {
    return null;
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const IMG_SRC: string[] = [
  "'self'",
  "data:",
  "blob:",
  "https://res.cloudinary.com",
  "https://img.clerk.com",
  "https://images.clerk.com",
  "https://ui-avatars.com",
  "https://i.ytimg.com",
  "https://*.clerk.com",
];

const MEDIA_SRC: string[] = ["'self'", "blob:"];

const CONNECT_SRC: string[] = [
  "'self'",
  "https://api.openai.com",
  "wss://*.openai.com",
  "https://api.stripe.com",
  "https://*.stripe.com",
  "https://api.clerk.com",
  "https://*.clerk.accounts.dev",
  "https://tavily.com",
  "https://api.tavily.com",
  "https://api.firecrawl.dev",
];

const qdrantOrigin = parseOrigin(process.env.QDRANT_URL);
if (qdrantOrigin) CONNECT_SRC.push(qdrantOrigin);

const redisOrigin = parseOrigin(process.env.REDIS_URL);
if (redisOrigin) CONNECT_SRC.push(redisOrigin);

if (process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY) {
  CONNECT_SRC.push("https://api.inngest.com", "wss://api.inngest.com");
}

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'strict-dynamic' 'unsafe-inline' https: http:`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src ${IMG_SRC.join(" ")}`,
  `media-src ${MEDIA_SRC.join(" ")}`,
  `font-src 'self' https: data:`,
  `connect-src ${CONNECT_SRC.join(" ")}`,
  `frame-src https:`,
  `frame-ancestors 'self'`,
  `worker-src blob: data:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ") + ";";

const cspReportOnly = process.env.CSP_ENFORCE !== "true";

function securityHeaders() {
  const headers: { key: string; value: string }[] = [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ];

  if (cspReportOnly) {
    headers.push({ key: "Content-Security-Policy-Report-Only", value: CSP });
  } else {
    headers.push({ key: "Content-Security-Policy", value: CSP });
  }

  return headers;
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "jsdom", "@mozilla/readability", "node-webvtt", "pdfkit", "fflate", "fontkit", "docx"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.com" },
      { protocol: "https", hostname: "ui-avatars.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    proxyClientMaxBodySize: "25mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
  devIndicators: false,
};

export default nextConfig;
