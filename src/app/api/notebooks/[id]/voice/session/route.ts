import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { consumeCredits, creditsExhaustedResponse } from "@/lib/credits";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { tavilyEnabled } from "@/lib/tavily";
import { createRealtimeClientSecret } from "samai-sdk/voice";
import { OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_REALTIME_MODEL, OPENAI_REALTIME_VOICE, VOICE_TOKEN_SECRET, VOICE_TOKEN_TTL_SECONDS, VOICE_CREDIT_COST_PER_BLOCK, VOICE_CREDIT_BLOCK_MINUTES, signToolToken } from "@/lib/voice/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_RATE_LIMIT = { limit: 5, windowSec: 60 };

export function activeSessionKey(userId: string) {
  return `voice:session:active:${userId}`;
}

async function claimActiveSession(userId: string, sessionId: string, ttlSeconds: number): Promise<boolean> {
  const key = activeSessionKey(userId);
  const setResult = await redis.set(key, sessionId, "EX", ttlSeconds, "NX");
  return setResult === "OK";
}

export async function releaseActiveSession(userId: string, sessionId: string): Promise<void> {
  const key = activeSessionKey(userId);
  const current = await redis.get(key);
  if (current === sessionId) {
    await redis.del(key).catch(() => {});
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const key = activeSessionKey(userId);
  const current = await redis.get(key);
  if (current) {
    await redis.del(key).catch(() => {});
  }

  return NextResponse.json({ released: !!current });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: notebookId } = await params;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook || notebook.ownerId !== userId) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const rl = await checkRateLimit(`ratelimit:voice:session:${userId}`, VOICE_RATE_LIMIT.limit, VOICE_RATE_LIMIT.windowSec);
  if (!rl.allowed) return rateLimitResponse(rl);

  if (!VOICE_TOKEN_SECRET) {
    return NextResponse.json({ error: "Voice is not configured on the server." }, { status: 500 });
  }

  let body: { refresh?: boolean; language?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as { refresh?: boolean; language?: string };
  } catch {
    // empty body is fine
  }

  const isRefresh = body.refresh === true;
  const language = body.language?.startsWith("en") ? "English" : body.language?.startsWith("hi") ? "Hindi" : body.language?.startsWith("ta") ? "Tamil" : "English";

  const sessionId = crypto.randomUUID();

  if (!isRefresh) {
    const claimed = await claimActiveSession(userId, sessionId, VOICE_CREDIT_BLOCK_MINUTES * 60);
    if (!claimed) {
      return NextResponse.json({ error: "You already have an active voice session. End it before starting a new one." }, { status: 409 });
    }

    const spend = await consumeCredits(userId, VOICE_CREDIT_COST_PER_BLOCK);
    if (!spend.allowed) {
      await releaseActiveSession(userId, sessionId).catch(() => {});
      return creditsExhaustedResponse(spend.status);
    }

    console.log(
      JSON.stringify({
        event: "voice_session_start",
        userId,
        notebookId,
        blocksCharged: VOICE_CREDIT_COST_PER_BLOCK,
        balanceAfter: spend.status.balance,
        timestamp: new Date().toISOString(),
      })
    );
  }

  const apiKey = OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 500 });
  }

  const model = OPENAI_REALTIME_MODEL;
  const voice = OPENAI_REALTIME_VOICE;

  const sources: Array<{ id: string; title: string }> = await db.source.findMany({
    where: { notebookId, status: "READY" },
    select: { id: true, title: true },
  });

  const sourceList = sources.map((s: { title: string }) => `- ${s.title}`).join("\n") || "No sources indexed yet.";

  let instructions = `You are the voice assistant for the notebook "${notebook.title}". The user has these sources:\n${sourceList}`;

  if (tavilyEnabled()) {
    instructions += `\n- You also have a search_web tool that searches live web results. Use it when the user asks something not covered by their notebook sources, or when they need the latest information on a topic.`;
  }

  instructions += `\n- Answer ONLY from results returned by search_notebook (or search_web when used). Always call search_notebook first before answering a factual question about the sources.\n- Before calling search_notebook, say "Let me check your sources."\n- Each search result is numbered [1], [2], etc. When you use a passage in your answer, briefly mention the source number (e.g. "According to source 1, …") so the user can find the cited passage.\n- If a tool returns no relevant passages, say you don't have enough in their sources (or the web for search_web). Never guess or use outside knowledge.\n- Keep answers short and conversational (1-3 sentences). You are speaking, not writing: no lists, no markdown, no URLs.\n- Mention where an answer comes from naturally ("on page 12", "around the 14 minute mark in the second video").\n- If interrupted, stop and respond to the new input.\n- Respond in ${language}.`;

  if (isRefresh) {
    const recent = await db.message.findMany({
      where: { notebookId, channel: "VOICE" },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    if (recent.length) {
      const summary = recent
        .reverse()
        .map((m) => `${m.role === "USER" ? "User" : "Assistant"}: ${m.content.slice(0, 120)}`)
        .join("\n");
      instructions += `\n\nRecent conversation summary:\n${summary}\n\nContinue the conversation naturally from here.`;
    }
  }

  try {
    const { value, expiresAt } = await createRealtimeClientSecret({
      apiKey,
      model,
      session: {
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-4o-transcribe" },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice },
        },
      },
      ttlSeconds: VOICE_TOKEN_TTL_SECONDS,
      baseUrl: OPENAI_BASE_URL,
    });

    const toolToken = signToolToken({
      userId,
      notebookId,
      sessionId,
    });

    const ttlSeconds = isRefresh ? VOICE_TOKEN_TTL_SECONDS : VOICE_CREDIT_BLOCK_MINUTES * 60;
    await redis.set(activeSessionKey(userId), sessionId, "EX", ttlSeconds);

    return NextResponse.json({
      clientSecret: value,
      model,
      voice,
      instructions,
      sessionId,
      toolToken,
      expiresAt,
    });
  } catch (err) {
    if (!isRefresh) {
      await releaseActiveSession(userId, sessionId).catch(() => {});
    }
    const message = err instanceof Error ? err.message : String(err);
    const statusMatch = /\((\d{3})/.exec(message);
    const status = statusMatch ? Number(statusMatch[1]) : 502;
    console.error("[voice/session] failed to mint client secret:", message);
    return NextResponse.json(
      { error: "Could not start a voice session. Please try again." },
      { status: status >= 400 && status < 600 ? status : 502 }
    );
  }
}
