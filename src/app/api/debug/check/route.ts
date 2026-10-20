import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { qdrant } from "@/lib/qdrant";
import { openai, CHAT_MODEL, EMBEDDING_MODEL } from "@/lib/openai";
import { getRequiredEnvVar } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "OPENAI_CHAT_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "QDRANT_URL",
  "QDRANT_API_KEY",
  "REDIS_URL",
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_APP_URL",
  "VOICE_TOKEN_SECRET",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_REALTIME_VOICE",
  "OPENAI_BASE_URL",
];

type CheckResult = { ok: boolean; error?: string };

function envPresence(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const name of REQUIRED_ENV_VARS) {
    const val = process.env[name];
    result[name] = Boolean(val && val.trim().length > 0);
  }
  return result;
}

async function checkOpenAIChat(): Promise<CheckResult> {
  try {
    const res = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    return { ok: !!res?.choices?.length };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

async function checkOpenAIEmbedding(): Promise<CheckResult> {
  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: "ping",
    });
    return { ok: !!res?.data?.length };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

async function checkQdrant(): Promise<CheckResult> {
  try {
    const collections = await qdrant.getCollections();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const val = await redis.ping();
    return { ok: val === "PONG" };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

async function checkVoiceSession(): Promise<CheckResult> {
  try {
    const apiKey = getRequiredEnvVar("OPENAI_API_KEY");
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
    const res = await fetch(`${base}/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        session: { type: "realtime", output_modalities: ["audio"] },
        expires_after: { anchor: "created_at", seconds: 10 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `OpenAI Realtime returned ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => null);
    return { ok: !!data?.value, error: data?.value ? undefined : "No client secret value in response" };
  } catch (err: any) {
    return { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expectedKey = process.env.DEBUG_KEY;

  if (!expectedKey || key !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized — set ?key=DEBUG_KEY" }, { status: 401 });
  }

  const envCheck = envPresence();

  let voiceCheck: CheckResult = { ok: false, error: "Skipped" };
  try {
    voiceCheck = await checkVoiceSession();
  } catch (err: any) {
    voiceCheck = { ok: false, error: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}` };
  }

  const checks: Record<string, CheckResult> = {};
  const testFns = [
    ["openai_chat", checkOpenAIChat],
    ["openai_embedding", checkOpenAIEmbedding],
    ["qdrant", checkQdrant],
    ["redis", checkRedis],
    ["database", checkDatabase],
  ] as const;

  try {
    const settled = await Promise.allSettled(testFns.map(([, fn]) => fn()));
    for (let i = 0; i < settled.length; i++) {
      const label = testFns[i][0];
      const result = settled[i];
      checks[label] = result.status === "fulfilled" ? result.value : { ok: false, error: String(result.reason) };
    }
  } catch {
    // timeout or unexpected error — checks that didn't complete stay at default
  }

  const allOk = Object.values(checks).every((c) => c.ok) && voiceCheck.ok;

  return NextResponse.json({ ok: allOk, env: envCheck, checks, voice: voiceCheck });
}
