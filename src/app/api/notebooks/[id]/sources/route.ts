import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { setProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
import { cloudinaryEnabled, uploadBuffer } from "@/lib/cloudinary";
import { z } from "zod";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

const jsonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEXT"), title: z.string().min(1).max(160), content: z.string().min(1) }),
  z.object({ type: z.literal("URL"), url: z.string().url() }),
  z.object({ type: z.literal("YOUTUBE"), url: z.string().url() }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.sourceUpload;
  const rl = await checkRateLimit(`ratelimit:upload:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;

  if (!(await ownedNotebook(notebookId, userId))) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";
  let source;
  // Only spent once the request is known-valid, right before the source row
  // (and the indexing work it triggers) is actually created — a malformed
  // upload shouldn't cost the user a credit.
  let spendStatus: Awaited<ReturnType<typeof consumeCredits>>["status"] | null = null;

  if (contentType.includes("multipart/form-data")) {
    // PDF or VTT file upload
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const type = form.get("type") as string | null;

    if (!file || (type !== "PDF" && type !== "VTT")) {
      return NextResponse.json({ error: "A PDF or VTT file is required" }, { status: 400 });
    }
    if (type === "PDF" && file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF exceeds 25MB limit" }, { status: 400 });
    }

    const spend = await consumeCredits(userId, CREDIT_COSTS.sourceUpload);
    if (!spend.allowed) return creditsExhaustedResponse(spend.status);
    spendStatus = spend.status;

    const buffer = Buffer.from(await file.arrayBuffer());

    // When Cloudinary is configured, upload the original file there and
    // keep only its URL — avoids stuffing a base64-encoded PDF (up to
    // ~33MB for a 25MB file) into the `rawText` Postgres column. The
    // ingest pipeline fetches the buffer back from `storagePath`. Falls
    // back to the original base64-in-rawText flow when Cloudinary isn't
    // configured, or if the upload itself fails (upload errors shouldn't
    // block adding the source — ingest will just use the fallback).
    let storagePath: string | null = null;
    let storagePublicId: string | null = null;
    let rawText: string | null = type === "VTT" ? buffer.toString("utf-8") : null;

    if (cloudinaryEnabled()) {
      try {
        const uploaded = await uploadBuffer(buffer, {
          resourceType: "raw",
          folder: `footnote/sources/${notebookId}`,
          filename: file.name,
        });
        storagePath = uploaded.url;
        storagePublicId = uploaded.publicId;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[sources] Cloudinary upload failed for ${file.name}, falling back to inline storage:`, err);
      }
    }

    if (type === "PDF" && !storagePath) {
      // Fallback: no Cloudinary (or the upload failed) — encode inline like
      // before, temporarily, until the ingest pipeline consumes and
      // replaces it with a short extracted-text preview.
      rawText = buffer.toString("base64");
    }

    source = await db.source.create({
      data: {
        notebookId,
        type,
        title: file.name,
        status: "QUEUED",
        rawText,
        storagePath,
        storagePublicId,
        fileSizeBytes: file.size,
      },
    });
  } else {
    const body = await req.json().catch(() => null);
    const parsed = jsonSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    const spend = await consumeCredits(userId, CREDIT_COSTS.sourceUpload);
    if (!spend.allowed) return creditsExhaustedResponse(spend.status);
    spendStatus = spend.status;

    if (data.type === "TEXT") {
      source = await db.source.create({
        data: { notebookId, type: "TEXT", title: data.title, status: "QUEUED", rawText: data.content },
      });
    } else {
      source = await db.source.create({
        data: {
          notebookId,
          type: data.type,
          title: data.url,
          status: "QUEUED",
          originUrl: data.url,
        },
      });
    }
  }

  await setProgress(source.id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });
  await db.notebook.update({ where: { id: notebookId }, data: { updatedAt: new Date() } });

  // Durable Inngest job so upload feels instant while extraction/embedding
  // happens in the background (visible via polling), with automatic
  // retries instead of a fire-and-forget `after()` call.
  const queued = await safeSend({ name: "source/created", data: { sourceId: source.id } });
  if (!queued) {
    // The Source row above already committed — don't let an enqueue
    // failure surface as a raw 500 ("Failed to upload") that hides a row
    // now stuck in QUEUED forever. Mark it FAILED with an explanation so
    // it's visible and retryable (via /api/sources/[id]/reindex) instead.
    const errorMessage =
      "Couldn't queue this source for processing. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await db.source.update({ where: { id: source.id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
    await setProgress(source.id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
  }

  return NextResponse.json(
    { source },
    {
      status: 201,
      headers: spendStatus
        ? {
            "X-Credits-Balance": String(spendStatus.balance),
            "X-Credits-Max": String(spendStatus.max),
            "X-Credits-Reset": String(spendStatus.resetAt),
          }
        : undefined,
    }
  );
}