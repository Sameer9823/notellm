import { createHmac } from "node:crypto";

export const VOICE_TOKEN_SECRET = process.env.VOICE_TOKEN_SECRET || undefined;

export const VOICE_TOKEN_TTL_SECONDS = Number(process.env.VOICE_TOKEN_TTL_SECONDS ?? 600);

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || undefined;
export const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
export const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

export const VOICE_CREDIT_BLOCK_MINUTES = Number(process.env.VOICE_CREDIT_BLOCK_MINUTES ?? 5);
export const VOICE_CREDIT_COST_PER_BLOCK = Number(process.env.VOICE_CREDIT_COST_PER_BLOCK ?? 1);

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
