import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};