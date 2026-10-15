import { NextResponse } from "next/server";

/**
 * Liveness probe — returns immediately with `{ ok: true }` and makes zero
 * external dependency calls. Uptime monitors and container orchestrators
 * should hit this route. For dependency-readiness, hit `/api/health/ready`
 * (which requires a shared `x-health-token` header so it can't be used as an
 * unauthenticated oracle into the app's backend state).
 */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
