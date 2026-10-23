import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { screenshotUrl } from "@/lib/screenshot";
import { getCachedSnapshotUrl, setCachedSnapshotUrl } from "@/lib/redis";
import { validateAndResolveUrl } from "@/lib/ssrf";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit — screenshot generation is expensive (external API + Cloudinary).
  const rl = await checkRateLimit(`ratelimit:snapshot:${userId}`, RATE_LIMITS.screenshot.limit, RATE_LIMITS.screenshot.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { url, sourceId } = body as { url?: string; sourceId?: string };
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // SSRF-protect the URL before doing anything with it.
  const validation = await validateAndResolveUrl(url);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error ?? "Invalid URL" }, { status: 400 });
  }

  // If a sourceId is provided, verify ownership (the source must belong to
  // the current user's notebook). This prevents one user from snapshotting
  // URLs from another user's notebook.
  if (sourceId) {
    const source = await db.source.findUnique({
      where: { id: sourceId },
      include: { notebook: { select: { ownerId: true } } },
    });
    if (!source || source.notebook.ownerId !== userId) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // If the Source already has a cached snapshot, return the Cloudinary URL
    // without re-screenshotting.
    if (source.snapshotUrl) {
      return NextResponse.json({ imageUrl: source.snapshotUrl });
    }
  }

  // Check Redis cache for ephemeral (WEB citation) snapshots.
  const urlHash = crypto.createHash("sha256").update(url).digest("hex");
  const cached = await getCachedSnapshotUrl(urlHash);
  if (cached) {
    return NextResponse.json({ imageUrl: cached });
  }

  // Generate a new screenshot.
  const imageUrl = await screenshotUrl(url);
  if (!imageUrl) {
    return NextResponse.json(
      { error: "Couldn't generate a snapshot (Firecrawl or Cloudinary not configured, or the page blocked scraping)" },
      { status: 502 }
    );
  }

  // Persist to the Source row if one was identified, so future loads skip
  // the generation step entirely.
  if (sourceId) {
    // Re-fetch to get the latest (it might have been cached above).
    const source = await db.source.findUnique({ where: { id: sourceId } });
    if (source) {
      await db.source.update({
        where: { id: sourceId },
        data: { snapshotUrl: imageUrl, snapshotPublicId: imageUrl },
      });
    }
  }

  // Return the Cloudinary URL for the snapshot.
  return NextResponse.json({ imageUrl });
}
