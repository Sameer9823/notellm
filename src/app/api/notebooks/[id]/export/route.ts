import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { buildExportDocument } from "@/lib/export/assemble";
import { renderDocx } from "@/lib/export/renderDocx";
import { renderPdf } from "@/lib/export/renderPdf";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  format: z.enum(["pdf", "docx"]),
  sections: z.array(z.string()).default([]),
  includeChat: z.boolean().default(false),
  includeCitations: z.boolean().default(false),
  includeSourceText: z.boolean().default(false),
  includeAISummary: z.boolean().default(false),
  includeMemory: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = { limit: 20, windowSec: 60 };
  const rl = await checkRateLimit(`ratelimit:export:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await currentUser();
  const displayName =
    user?.fullName ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    null;

  const exportDoc = await buildExportDocument(notebookId, userId, displayName, parsed.data);
  if (!exportDoc) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  const filename = `${slugify(exportDoc.title)}-${new Date().toISOString().slice(0, 10)}.${parsed.data.format}`;

  let buffer: Buffer;
  if (parsed.data.format === "docx") {
    buffer = await renderDocx(exportDoc);
  } else {
    buffer = await renderPdf(exportDoc);
  }

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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}