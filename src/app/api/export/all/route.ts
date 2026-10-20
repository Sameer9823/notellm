import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildExportDocument } from "@/lib/export/assemble";
import { renderDocx } from "@/lib/export/renderDocx";
import { renderPdf } from "@/lib/export/renderPdf";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { zip } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  format: z.enum(["pdf", "docx"]),
  notebookIds: z.array(z.string()).optional(),
  sections: z.array(z.string()).default([]),
  includeChat: z.boolean().default(false),
  includeCitations: z.boolean().default(false),
  includeSourceText: z.boolean().default(false),
  includeAISummary: z.boolean().default(false),
  includeMemory: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = { limit: 5, windowSec: 60 };
  const rl = await checkRateLimit(`ratelimit:export-all:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const user = await currentUser();
  const displayName =
    user?.fullName ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    null;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const where = parsed.data.notebookIds?.length
    ? { id: { in: parsed.data.notebookIds }, ownerId: userId }
    : { ownerId: userId };

  const notebooks = await db.notebook.findMany({
    where,
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  if (notebooks.length === 0) {
    return NextResponse.json({ error: "No notebooks found" }, { status: 404 });
  }

  const results = await Promise.all(
    notebooks.map(async (nb) => {
      const exportDoc = await buildExportDocument(nb.id, userId, displayName, parsed.data);
      if (!exportDoc) return null;
      const buffer = parsed.data.format === "docx"
        ? await renderDocx(exportDoc)
        : await renderPdf(exportDoc);
      const filename = `${slugify(exportDoc.title)}-${new Date().toISOString().slice(0, 10)}.${parsed.data.format}`;
      return { filename, buffer };
    })
  );

  const files = results.filter((r): r is { filename: string; buffer: Buffer } => r !== null);

  if (files.length === 1) {
    const { filename, buffer } = files[0];
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": parsed.data.format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  }

  const zipEntries: Record<string, Uint8Array> = {};
  for (const f of files) {
    zipEntries[f.filename] = new Uint8Array(f.buffer);
  }
  const zipBuffer = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipEntries, (err, data) => (err ? reject(err) : resolve(data)));
  });

  return new NextResponse(Buffer.from(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="footnote-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Content-Length": String(zipBuffer.length),
    },
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}