import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Gates the /test/* routes behind ENABLE_TEST_HARNESS.
 *
 * These pages exist purely so Playwright can exercise real components without
 * a signed-in Clerk session. In production they must never be reachable —
 * returning 404 keeps them invisible to users and, crucially, stops Next.js
 * from statically prerendering them (several use `useSearchParams()`, which
 * bails out of static rendering under the prod compiler).
 *
 * CI sets ENABLE_TEST_HARNESS=1 when running Playwright so the routes resolve.
 */
export default function TestHarnessLayout({ children }: { children: ReactNode }) {
  const isProduction = process.env.NODE_ENV === "production";
  const harnessEnabled = process.env.ENABLE_TEST_HARNESS === "1";

  if (isProduction && !harnessEnabled) {
    notFound();
  }

  return <>{children}</>;
}
