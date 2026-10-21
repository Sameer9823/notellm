import { z } from "zod";

/**
 * Central, validated environment configuration.
 *
 * Env vars are parsed lazily (on first access of `serverEnv`/`clientEnv`),
 * NOT at import time. This prevents a single missing env var from crashing
 * the entire module graph — which would take down every API route, including
 * health checks, at deployment time. Instead, missing required vars surface
 * as clear errors at the specific route that needs them, while optional
 * vars fall back to their schema defaults.
 *
 * `serverEnv`  — server-only values (never import from client components).
 * `clientEnv`  — safe to use in React Server Components or client components.
 */

const coercedNumber = z.preprocess(
  (val) => (val === undefined || val === "" ? undefined : Number(val)),
  z.number().positive()
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  HEALTH_TOKEN: z.string().min(1),
  DEBUG_KEY: z.string().optional(),
  VOICE_TOKEN_SECRET: z.string().min(1),

  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_TTS_MODEL: z.string().default("tts-1"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime"),
  OPENAI_REALTIME_VOICE: z.string().default("marin"),

  QDRANT_COLLECTION: z.string().default("footnote_chunks"),
  QDRANT_MEMORY_COLLECTION: z.string().default("user_memories"),

  CREDITS_MAX_PER_WINDOW: coercedNumber.default(200),
  CREDITS_WINDOW_HOURS: coercedNumber.default(6),

  VOICE_TOKEN_TTL_SECONDS: coercedNumber.default(600),
  VOICE_CREDIT_COST_PER_BLOCK: coercedNumber.default(1),
  VOICE_CREDIT_BLOCK_MINUTES: coercedNumber.default(5),
  NEXT_PUBLIC_VOICE_CREDIT_BLOCK_MINUTES: coercedNumber.default(5),
  NEXT_PUBLIC_MAX_SESSION_MINUTES: coercedNumber.optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  FIRECRAWL_API_KEY: z.string().optional(),

  TAVILY_API_KEY: z.string().optional(),
  NEXT_PUBLIC_TAVILY_ENABLED: z.enum(["true", "false"]).default("false"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PACK_STARTER: z.string().optional(),
  STRIPE_PRICE_PACK_PRO: z.string().optional(),
  STRIPE_PRICE_PACK_POWER: z.string().optional(),
  STRIPE_PRICE_PLAN_PLUS: z.string().optional(),
  STRIPE_PRICE_PLAN_PRO: z.string().optional(),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INNGEST_DEVSERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_INNGEST_DEVSERVER_URL: z.string().url().optional(),
  REACT_APP_INNGEST_DEVSERVER_URL: z.string().url().optional(),

  SEARCHAPI_API_KEY: z.string().optional(),
  YT_PROXY_URL: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  CSP_ENFORCE: z.enum(["true", "false"]).default("false"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Lazily parses and validates env vars. Uses `.partial()` so that missing
 * required fields yield `undefined` instead of throwing — callers that need
 * a required field should check for `undefined` and return a clear 500.
 */
const _rawEnv = (typeof window === "undefined" ? process.env : {}) as Record<string, string | undefined>;
let _parsed: Record<string, unknown> | null = null;

function getParsed(): Record<string, unknown> {
  if (_parsed) return _parsed;
  const result = envSchema.partial().safeParse(_rawEnv);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.warn("[env] Environment validation issues (using defaults/undefined for invalid fields):\n" + issues);
    _parsed = { ..._rawEnv };
  } else {
    _parsed = result.data as Record<string, unknown>;
  }
  return _parsed;
}

function pick(name: keyof z.infer<typeof envSchema>, fallback?: string): string | undefined {
  const val = getParsed()[name as string];
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

export function getRequiredEnvVar(name: keyof z.infer<typeof envSchema>): string {
  const val = getParsed()[name as string];
  if (typeof val !== "string" || val.length === 0) {
    const hint = name.startsWith("NEXT_PUBLIC_") ? "Set this in Vercel Project Settings → Environment Variables." : "Set this in your Vercel Project Settings → Environment Variables.";
    throw new Error(`Required environment variable ${name} is not set. ${hint}`);
  }
  return val;
}

export const serverEnv = {
  database: { url: pick("DATABASE_URL")!, directUrl: pick("DIRECT_URL")! },
  clerk: { secretKey: pick("CLERK_SECRET_KEY")!, webhookSecret: pick("CLERK_WEBHOOK_SECRET") },
  openai: {
    apiKey: pick("OPENAI_API_KEY"),
    baseUrl: pick("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    chatModel: pick("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini",
    embeddingModel: pick("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    // `gpt-4o-mini-tts` sounds better but takes 3-120s per line (measured),
    // which puts a full podcast far beyond a 300s serverless function. The
    // classic `tts-1` model renders the same text in ~3.5s, so the whole
    // episode synthesises in seconds. Set OPENAI_TTS_MODEL to override.
    ttsModel: pick("OPENAI_TTS_MODEL") ?? "tts-1",
    realtimeModel: pick("OPENAI_REALTIME_MODEL") ?? "gpt-realtime",
    realtimeVoice: pick("OPENAI_REALTIME_VOICE") ?? "marin",
  },
  qdrant: {
    url: pick("QDRANT_URL")!,
    apiKey: pick("QDRANT_API_KEY")!,
    collection: pick("QDRANT_COLLECTION") ?? "footnote_chunks",
    memoryCollection: pick("QDRANT_MEMORY_COLLECTION") ?? "user_memories",
  },
  redis: { url: pick("REDIS_URL")! },
  cloudinary: {
    enabled: !!(pick("CLOUDINARY_CLOUD_NAME") && pick("CLOUDINARY_API_KEY") && pick("CLOUDINARY_API_SECRET")),
    cloudName: pick("CLOUDINARY_CLOUD_NAME"),
    apiKey: pick("CLOUDINARY_API_KEY"),
    apiSecret: pick("CLOUDINARY_API_SECRET"),
  },
  tavily: { enabled: !!pick("TAVILY_API_KEY"), apiKey: pick("TAVILY_API_KEY") },
  firecrawl: { enabled: !!pick("FIRECRAWL_API_KEY"), apiKey: pick("FIRECRAWL_API_KEY") },
  stripe: {
    enabled: !!pick("STRIPE_SECRET_KEY"),
    secretKey: pick("STRIPE_SECRET_KEY"),
    webhookSecret: pick("STRIPE_WEBHOOK_SECRET"),
    prices: {
      packStarter: pick("STRIPE_PRICE_PACK_STARTER"),
      packPro: pick("STRIPE_PRICE_PACK_PRO"),
      packPower: pick("STRIPE_PRICE_PACK_POWER"),
      planPlus: pick("STRIPE_PRICE_PLAN_PLUS"),
      planPro: pick("STRIPE_PRICE_PLAN_PRO"),
    },
  },
  inngest: {
    eventKey: pick("INNGEST_EVENT_KEY"),
    signingKey: pick("INNGEST_SIGNING_KEY"),
    devserverUrl: pick("INNGEST_DEVSERVER_URL") ?? pick("NEXT_PUBLIC_INNGEST_DEVSERVER_URL") ?? pick("REACT_APP_INNGEST_DEVSERVER_URL"),
  },
  voice: {
    tokenSecret: pick("VOICE_TOKEN_SECRET"),
    tokenTtlSeconds: Number(pick("VOICE_TOKEN_TTL_SECONDS") ?? 600),
    creditCostPerBlock: Number(pick("VOICE_CREDIT_COST_PER_BLOCK") ?? 1),
    creditBlockMinutes: Number(pick("VOICE_CREDIT_BLOCK_MINUTES") ?? 5),
    maxSessionMinutes: pick("NEXT_PUBLIC_MAX_SESSION_MINUTES") ? Number(pick("NEXT_PUBLIC_MAX_SESSION_MINUTES")) : null,
  },
  credits: {
    maxPerWindow: Number(pick("CREDITS_MAX_PER_WINDOW") ?? 200),
    windowHours: Number(pick("CREDITS_WINDOW_HOURS") ?? 6),
  },
  healthToken: pick("HEALTH_TOKEN")!,
  searchApiKey: pick("SEARCHAPI_API_KEY"),
  ytProxyUrl: pick("YT_PROXY_URL"),
  cspEnforce: pick("CSP_ENFORCE") === "true",
  nodeEnv: pick("NODE_ENV") ?? "development",
  isProduction: pick("NODE_ENV") === "production",
};

export const clientEnv = {
  appUrl: pick("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  clerkPublishableKey: pick("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")!,
  tavilyEnabled: pick("NEXT_PUBLIC_TAVILY_ENABLED") === "true",
  inngestDevserverUrl: pick("NEXT_PUBLIC_INNGEST_DEVSERVER_URL"),
  voiceCreditBlockMinutes: Number(pick("NEXT_PUBLIC_VOICE_CREDIT_BLOCK_MINUTES") ?? 5),
  maxSessionMinutes: pick("NEXT_PUBLIC_MAX_SESSION_MINUTES") ? Number(pick("NEXT_PUBLIC_MAX_SESSION_MINUTES")) : 60,
};
