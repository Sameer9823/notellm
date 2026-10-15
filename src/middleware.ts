import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

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
  // Deliberately NOT /api/billing/webhook — Stripe calls that route
  // directly and authenticates via its own signature, not Clerk.
  // Deliberately NOT /api/inngest — Inngest (or the local dev server)
  // calls back into it directly and authenticates via its own signing
  // key, not Clerk.
  // Deliberately NOT /api/health or /api/public/* — public/unauthenticated
  // routes get IP-based rate limiting below instead.
]);

// --- IP-based rate limiting for public/unauthenticated routes ---
// Generous limits: the goal is abuse prevention, not quota enforcement.
type IpRouteConfig = { pattern: ReturnType<typeof createRouteMatcher>; limitKey: keyof typeof RATE_LIMITS };

const IP_RATE_LIMITED: IpRouteConfig[] = [
  { pattern: createRouteMatcher(["/api/public/(.*)"]), limitKey: "ipPublic" },
  { pattern: createRouteMatcher(["/api/health(.*)"]), limitKey: "ipHealth" },
  { pattern: createRouteMatcher(["/api/voice/tools/(.*)"]), limitKey: "ipPublic" },
  { pattern: createRouteMatcher(["/api/billing/webhook"]), limitKey: "ipBillingWebhook" },
];

// --- Per-user rate limiting for authenticated mutation routes ---
type UserRouteConfig = { pattern: ReturnType<typeof createRouteMatcher>; limitKey: keyof typeof RATE_LIMITS; methods?: string[] };

const USER_RATE_LIMITED: UserRouteConfig[] = [
  { pattern: createRouteMatcher(["/api/sources/*/reindex"]), limitKey: "sourceReindex", methods: ["POST"] },
  { pattern: createRouteMatcher(["/api/sources/*/file"]), limitKey: "sourceUpload", methods: ["POST"] },
  { pattern: createRouteMatcher(["/api/notebooks"]), limitKey: "notebookMutate", methods: ["POST"] },
  { pattern: createRouteMatcher(["/api/notebooks/*"]), limitKey: "notebookMutate", methods: ["DELETE"] },
  { pattern: createRouteMatcher(["/api/notebooks/*/share"]), limitKey: "shareToggle" },
  { pattern: createRouteMatcher(["/api/notes/*"]), limitKey: "notes" },
  { pattern: createRouteMatcher(["/api/notebooks/*/notes"]), limitKey: "notes" },
  { pattern: createRouteMatcher(["/api/notebooks/*/voice/messages"]), limitKey: "voiceMessages", methods: ["POST"] },
  { pattern: createRouteMatcher(["/api/billing/checkout"]), limitKey: "billingCheckout" },
  { pattern: createRouteMatcher(["/api/billing/portal"]), limitKey: "billingPortal" },
];

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export default clerkMiddleware(async (auth, req) => {
  // 1. IP-based rate limiting for public/unauthenticated routes (before auth).
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

  // 2. Auth for protected routes.
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  // 3. Per-user rate limiting for authenticated mutation routes.
  // Only fetch the auth state if the route matches one of our per-user
  // rate-limited patterns — avoids a Clerk round-trip on every request.
  const matchesUserRoute = USER_RATE_LIMITED.some(
    ({ pattern, methods }) => pattern(req) && (!methods || methods.includes(req.method))
  );
  if (matchesUserRoute) {
    const { userId } = await auth();
    if (userId) {
      for (const { pattern, limitKey, methods } of USER_RATE_LIMITED) {
        if (pattern(req) && (!methods || methods.includes(req.method))) {
          const cfg = RATE_LIMITS[limitKey];
          const rl = await checkRateLimit(`ratelimit:user:${userId}:${limitKey}`, cfg.limit, cfg.windowSec);
          if (!rl.allowed) {
            return rateLimitResponse(rl);
          }
          break;
        }
      }
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
