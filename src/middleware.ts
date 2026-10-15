import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

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
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/billing/summary",
]);

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export default clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname.startsWith("/api/inngest")) {
    return NextResponse.next();
  }

  // Rate limiting only in production (Redis not running locally)
  if (serverEnv.isProduction) {
    // Dynamic imports to avoid initializing Redis client in development
    const { checkRateLimit, rateLimitResponse, RATE_LIMITS } = await import("@/lib/rate-limit");

    // --- IP-based rate limiting for public/unauthenticated routes ---
    type IpRouteConfig = { pattern: ReturnType<typeof createRouteMatcher>; limitKey: keyof typeof RATE_LIMITS };

    const IP_RATE_LIMITED: IpRouteConfig[] = [
      { pattern: createRouteMatcher(["/api/public/(.*)"]), limitKey: "ipPublic" },
      { pattern: createRouteMatcher(["/api/health(.*)"]), limitKey: "ipHealth" },
      { pattern: createRouteMatcher(["/api/voice/tools/(.*)"]), limitKey: "ipPublic" },
      { pattern: createRouteMatcher(["/api/billing/webhook"]), limitKey: "ipBillingWebhook" },
    ];

    for (const { pattern, limitKey } of IP_RATE_LIMITED) {
      if (pattern(req)) {
        const cfg = RATE_LIMITS[limitKey];
        const ip = getClientIp(req);
        const rl = await checkRateLimit(`ratelimit:ip:${ip}:${limitKey}`, cfg.limit, cfg.windowSec);
        if (!rl.allowed) {
          return rateLimitResponse(rl);
        }
        break;
      }
    }
  }

  // Auth for protected routes.
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