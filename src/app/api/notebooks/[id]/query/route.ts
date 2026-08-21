import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { streamAnswer, extractCitations } from "@/lib/rag";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeCredits, creditsExhaustedResponse, CREDIT_COSTS } from "@/lib/credits";
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

  const priorMessages = await db.message.findMany({
    where: { notebookId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const history = priorMessages.map((m: { role: string; content: string }) => ({
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
  const { chunks, stream } = await streamAnswer(notebookId, question, history, sourceId, memoryContext, webSearch);

  // Only true if even the out-of-source general-knowledge stream failed to
  // start (e.g. OpenAI is unreachable) — normal "nothing in sources" cases
  // are now handled by streaming a flagged general-knowledge answer instead
  // of a static refusal, so the user always gets a useful response.
  if (!stream) {
    const fallback = sourceId
      ? "That source doesn't contain enough content to answer this — or nothing in it relates closely enough. Try switching to \"All sources\", or ask something else about this source."
      : "This notebook doesn't have any indexed sources yet — or none of them relate closely enough to answer that. Add a source, or wait for indexing to finish, then try again.";
    await db.message.create({ data: { notebookId, role: "ASSISTANT", content: fallback, citations: [] } });
    return NextResponse.json({ answer: fallback, citations: [] }, { headers: creditsHeaders });
  }

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
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", ...creditsHeaders },
  });
}