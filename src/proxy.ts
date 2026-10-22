// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/notebook(.*)",
  "/settings(.*)",
  "/api/notebooks(.*)",
  "/api/sources(.*)",
  "/api/web-preview(.*)",
  "/api/notes(.*)",
  "/api/credits(.*)",
  "/api/review(.*)",
  "/api/memory(.*)",
  "/api/export(.*)",
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/billing/summary",
]);

const isInngest = createRouteMatcher(["/api/inngest(.*)"]);

// Dev-only diagnostics routes (e.g. /api/dev/inngest-status) — always public
// so they're reachable without auth in local dev, and they 404 in production
// themselves so they can't leak from a deployed instance.
const isDevDiagnostics = createRouteMatcher(["/api/dev/(.*)"]);

const IP_RATE_LIMITED = [
  { pattern: createRouteMatcher(["/api/public/(.*)"]), limitKey: "ipPublic" },
  { pattern: createRouteMatcher(["/api/health(.*)"]), limitKey: "ipHealth" },
  { pattern: createRouteMatcher(["/api/voice/tools/(.*)"]), limitKey: "ipPublic" },
  { pattern: createRouteMatcher(["/api/billing/webhook"]), limitKey: "ipBillingWebhook" },
] as const;

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export default clerkMiddleware(async (auth, req) => {
  if (isInngest(req)) return NextResponse.next();
  if (isDevDiagnostics(req)) return NextResponse.next();

  // Rate limiting: production only, and fail-open so Redis problems never take the site down
  if (process.env.NODE_ENV === "production") {
    const match = IP_RATE_LIMITED.find(({ pattern }) => pattern(req));
    if (match) {
      try {
        const { checkRateLimit, rateLimitResponse, RATE_LIMITS } = await import("@/lib/rate-limit");
        const cfg = RATE_LIMITS[match.limitKey];
        const ip = getClientIp(req);
        const rl = await checkRateLimit(`ratelimit:ip:${ip}:${match.limitKey}`, cfg.limit, cfg.windowSec);
        if (!rl.allowed) return rateLimitResponse(rl);
      } catch (err) {
        console.error("[proxy] rate limit check failed, allowing request", err);
      }
    }
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};