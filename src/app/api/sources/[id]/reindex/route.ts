import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { setProgress } from "@/lib/redis";
import { safeSend } from "@/lib/inngest/client";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const source = await db.source.findUnique({ where: { id }, include: { notebook: true } });
  if (!source || source.notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await db.source.update({ where: { id }, data: { status: "QUEUED", errorMessage: null } });
  await setProgress(id, { status: "QUEUED", percent: 0, updatedAt: Date.now() });

  // Durable Inngest job — retries automatically instead of a fire-and-forget `after()` call.
  const queued = await safeSend({ name: "source/created", data: { sourceId: id } });
  if (!queued) {
    const errorMessage =
      "Couldn't queue this source for processing. If you're running locally, make sure `npx inngest-cli@latest dev` is running alongside `npm run dev`; in production, check INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are set.";
    await db.source.update({ where: { id }, data: { status: "FAILED", errorMessage } }).catch(() => {});
    await setProgress(id, { status: "FAILED", percent: 0, updatedAt: Date.now(), errorMessage });
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
