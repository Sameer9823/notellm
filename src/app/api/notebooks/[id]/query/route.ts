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

// Sentinel the client splits on to separate the streamed prose from the
// trailing citations payload, without needing a second round-trip.
const CITATIONS_MARKER = "\n\u0000CITATIONS\u0000";

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

  // Guard against scoping to a source that doesn't belong to this notebook
  // (or doesn't exist) — silently fall back to "all sources" rather than
  // erroring, since this only ever comes from the sources rail selection.
  if (sourceId) {
    const scoped = await db.source.findUnique({ where: { id: sourceId }, select: { notebookId: true } });
    if (!scoped || scoped.notebookId !== notebookId) sourceId = null;
  }

  const spend = await consumeCredits(userId, CREDIT_COSTS.chat);
  if (!spend.allowed) return creditsExhaustedResponse(spend.status);

  // Fetch the most recent 20 messages (descending), then reverse to
  // chronological order so the model sees the latest turns. The previous
  // `orderBy: "asc"` + `take: 20` returned the OLDEST 20 messages, which
  // meant after ~10 exchanges the model never saw the current conversation.
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

  // Surfaced on every response so the client-side credits badge can update
  // instantly from the same round trip, without a separate /api/credits poll.
  const creditsHeaders = {
    "X-Credits-Balance": String(spend.status.balance),
    "X-Credits-Max": String(spend.status.max),
    "X-Credits-Reset": String(spend.status.resetAt),
  };

  const memoryContext = await getMemoryContext(userId, question).catch(() => "");

  let retrieval: Awaited<ReturnType<typeof streamAnswer>>;
  try {
    retrieval = await streamAnswer(notebookId, question, history, sourceId, memoryContext, webSearch);
  } catch (err) {
    // streamAnswer threw before streaming started (e.g. OpenAI unreachable).
    // Refund the consumed credit and return a clean 502 so the client can
    // surface a useful error instead of a bare 500 after a silent credit loss.
    void refundCredits(userId, CREDIT_COSTS.chat);
    // eslint-disable-next-line no-console
    console.error("[query] streamAnswer failed before streaming:", describeError(err));
    return NextResponse.json(
      { error: "The AI service is temporarily unavailable. Your credit has been refunded." },
      { status: 502, headers: creditsHeaders }
    );
  }

  const { chunks, stream } = retrieval;

  const encoder = new TextEncoder();
  let full = "";

  const readable = new ReadableStream({
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

        // Ported from sourcelm's rolling conversation-memory sync: extract
        // durable facts from this exchange in the background so future
        // conversations (in any notebook) can draw on them. Fire-and-forget
        // and best-effort — never blocks or fails the chat response.
        after(() =>
          extractMemoriesFromMessages(userId, [
            { role: "user", content: question },
            { role: "assistant", content: full },
          ])
        );
      } catch (err) {
        // Stream failed after partial output — save what was streamed as the
        // assistant message, refund the credit, and surface a clean error.
        void refundCredits(userId, CREDIT_COSTS.chat);
        // eslint-disable-next-line no-console
        console.error("[query] stream failed mid-response:", describeError(err));
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
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", ...creditsHeaders },
  });
}