import { createHmac } from "node:crypto";
import { serverEnv } from "@/lib/env";

const _env = serverEnv.voice;

export const VOICE_TOKEN_SECRET = _env.tokenSecret;
export const VOICE_TOKEN_TTL_SECONDS = _env.tokenTtlSeconds;
export const OPENAI_API_KEY = serverEnv.openai.apiKey;
export const OPENAI_REALTIME_MODEL = serverEnv.openai.realtimeModel;
export const OPENAI_REALTIME_VOICE = serverEnv.openai.realtimeVoice;
export const OPENAI_BASE_URL = serverEnv.openai.baseUrl;
export const VOICE_CREDIT_BLOCK_MINUTES = _env.creditBlockMinutes;
export const VOICE_CREDIT_COST_PER_BLOCK = _env.creditCostPerBlock;

export function signToolToken(payload: Record<string, unknown>, ttlSeconds: number = VOICE_TOKEN_TTL_SECONDS): string {
  if (!VOICE_TOKEN_SECRET) throw new Error("VOICE_TOKEN_SECRET is not configured");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = JSON.stringify({ ...payload, exp });
  const sig = createHmac("sha256", VOICE_TOKEN_SECRET).update(body).digest("base64url");
  return `${btoa(body)}.${sig}`;
}

export function verifyToolToken(token: string): { payload: Record<string, unknown> } | null {
  if (!VOICE_TOKEN_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let body: string;
  try {
    body = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", VOICE_TOKEN_SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  const payload = JSON.parse(body) as { exp: number; [key: string]: unknown };
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { payload };
}
