import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { streamAnswer, extractCitations } from "@/lib/rag";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS, refundCredits } from "@/lib/credits";
import { describeError } from "@/lib/utils";
import { getMemoryContext, extractMemoriesFromMessages } from "@/lib/memory";
import { z } from "zod";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  sourceId: z.string().min(1).nullable().optional(),
  webSearch: z.boolean().optional().default(false),
});

const CITATIONS_MARKER = "\n\u0000CITATIONS\u0000";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logError(context: string, err: unknown) {
  const e = err as { name?: string; message?: string; status?: number; code?: string | number; cause?: unknown };
  // eslint-disable-next-line no-console
  console.error(
    `[${context}]`,
    JSON.stringify({
      name: e?.name ?? typeof err,
      message: e?.message ?? String(err),
      status: e?.status,
      code: e?.code,
      cause: e?.cause ? { name: (e.cause as Error)?.name, message: (e.cause as Error)?.message } : undefined,
    })
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { limit, windowSec } = RATE_LIMITS.chat;
  const rl = await checkRateLimit(`ratelimit:chat:${userId}`, limit, windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { id: notebookId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { question, webSearch } = parsed.data;
  let sourceId = parsed.data.sourceId ?? null;

  if (sourceId) {
    const scoped = await db.source.findUnique({ where: { id: sourceId }, select: { notebookId: true } });
    if (!scoped || scoped.notebookId !== notebookId) sourceId = null;
  }

  const spend = await consumeCredits(userId, CREDIT_COSTS.chat);
  if (!spend.allowed) return creditsExhaustedResponse(spend.status);

  const priorMessages = await db.message.findMany({
    where: { notebookId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const history = priorMessages
    .reverse()
    .map((m: { role: string; content: string }) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

  await db.message.create({ data: { notebookId, role: "USER", content: question } });

  const creditsHeaders = {
    "X-Credits-Balance": String(spend.status.balance),
    "X-Credits-Max": String(spend.status.max),
    "X-Credits-Reset": String(spend.status.resetAt),
  };

  const memoryContext = await getMemoryContext(userId, question).catch((err) => {
    logError("query/getMemoryContext", err);
    return "";
  });

  let retrieval: Awaited<ReturnType<typeof streamAnswer>>;
  try {
    retrieval = await streamAnswer(notebookId, question, history, sourceId, memoryContext, webSearch);
  } catch (err) {
    void refundCredits(userId, CREDIT_COSTS.chat);
    logError("query/streamAnswer", err);
    return NextResponse.json(
      { error: "The AI service is temporarily unavailable. Your credit has been refunded." },
      { status: 502, headers: creditsHeaders }
    );
  }

  const { chunks, stream } = retrieval;

  const encoder = new TextEncoder();
  let full = "";

  const readable = new ReadableStream(
    {
      async start(controller) {
        try {
          for await (const part of stream) {
            const delta = part.choices[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              controller.enqueue(encoder.encode(delta));
            }
          }
          const citations = extractCitations(full, chunks);
          await db.message.create({
            data: { notebookId, role: "ASSISTANT", content: full, citations },
          });
          controller.enqueue(encoder.encode(CITATIONS_MARKER + JSON.stringify(citations)));
          controller.close();

          after(() =>
            extractMemoriesFromMessages(userId, [
              { role: "user", content: question },
              { role: "assistant", content: full },
            ])
          );
        } catch (err) {
          void refundCredits(userId, CREDIT_COSTS.chat);
          logError("query/stream-mid", err);
          const message = full.trim()
            ? `${full.trim()}\n\n[Response was interrupted before completion.]`
            : "The response was interrupted before completion.";
          await db.message.create({
            data: { notebookId, role: "ASSISTANT", content: message, citations: [] },
          });
          controller.enqueue(encoder.encode(CITATIONS_MARKER + JSON.stringify([])));
          controller.error(new Error("Stream interrupted"));
        }
      },
    },
    { highWaterMark: 1 }
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Content-Encoding": "none",
      "X-Accel-Buffering": "no",
      ...creditsHeaders,
    },
  });
}
