import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { setProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
import { cloudinaryEnabled, uploadBuffer } from "@/lib/cloudinary";
import { z } from "zod";

const MAX_PDF_BYTES = 100 * 1024 * 1024;

async function ownedNotebook(id: string, userId: string) {
  const notebook = await db.notebook.findUnique({ where: { id } });
  if (!notebook || notebook.ownerId !== userId) return null;
  return notebook;
}

const jsonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TEXT"), title: z.string().min(1).max(160), content: z.string().min(1) }),
  z.object({ type: z.literal("URL"), url: z.string().url() }),
  z.object({ type: z.literal("YOUTUBE"), url: z.string().url() }),
  // PDF already uploaded straight to Cloudinary by the browser (avoids the
  // ~4.5MB Vercel request-body limit that multipart uploads hit).
  z.object({
    type: z.literal("PDF"),
    title: z.string().min(1).max(255),
    fileSizeBytes: z.number().int().positive().max(MAX_PDF_BYTES),
    storagePath: z.string().url(),
    storagePublicId: z.string().min(1),
  }),
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
  let uploadWarning: string | null = null;
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
      return NextResponse.json({ error: "PDF exceeds 100MB limit" }, { status: 400 });
    }

    const spend = await consumeCredits(userId, CREDIT_COSTS.sourceUpload);
    if (!spend.allowed) return creditsExhaustedResponse(spend.status);
    spendStatus = spend.status;

    const buffer = Buffer.from(await file.arrayBuffer());

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
        uploadWarning = "Couldn't upload to Cloudinary — the original file is stored locally as a fallback and may need re-uploading later.";
      }
    }

    if (type === "PDF" && !storagePath && !cloudinaryEnabled()) {
      // Warning for local-dev / no-Cloudinary setups: the file is stored in
      // SourceFile as a fallback, but the user should know the PDF viewer
      // won't have a Cloudinary CDN URL.
      uploadWarning = "Cloudinary isn't configured — the original PDF is stored locally as a fallback and may need re-uploading after ingest.";
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

    // Persist the original file bytes in SourceFile when there's no Cloudinary
    // storagePath, so /api/sources/[id]/file can serve the PDF and the ingest
    // pipeline can re-extract without relying on the transient base64-in-rawText.
    if (type === "PDF" && !storagePath) {
      await db.sourceFile.create({
        data: { sourceId: source.id, data: buffer },
      });
    }
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

    if (data.type === "PDF") {
      // Only accept files that live in this notebook's Cloudinary folder, so a
      // client can't make the ingest job fetch an arbitrary URL.
      let host = "";
      try { host = new URL(data.storagePath).hostname; } catch {}
      if (host !== "res.cloudinary.com" || !data.storagePublicId.startsWith(`footnote/sources/${notebookId}/`)) {
        return NextResponse.json({ error: "Invalid file reference" }, { status: 400 });
      }
      source = await db.source.create({
        data: {
          notebookId,
          type: "PDF",
          title: data.title,
          status: "QUEUED",
          storagePath: data.storagePath,
          storagePublicId: data.storagePublicId,
          fileSizeBytes: data.fileSizeBytes,
        },
      });
    } else if (data.type === "TEXT") {
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
    { source, warning: uploadWarning },
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