import { z } from "zod";

/**
 * Central, validated environment configuration.
 *
 * All env vars pass through a Zod schema on import so that a misconfigured
 * deployment fails fast at startup with a readable message — rather than
 * crashing deep in a route handler with an opaque "key is undefined" error.
 *
 * `serverEnv`  — server-only values (never imported by client components).
 * `clientEnv`  — safe to use in React Server Components or client components.
 *
 * Optional features (Cloudinary, Tavily, Firecrawl, Stripe, Inngest, voice,
 * screenshot proxy) are marked explicitly and expose an `enabled` flag so
 * callers don't need to re-check multiple env vars.
 */

const coercedNumber = z.preprocess(
  (val) => (val === undefined || val === "" ? undefined : Number(val)),
  z.number().positive()
);

const envSchema = z.object({
  // ── Required: database ──
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  // ── Required: auth (Clerk) ──
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // ── Required: LLM (OpenAI) ──
  OPENAI_API_KEY: z.string().min(1),

  // ── Required: vector DB (Qdrant) ──
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().min(1),

  // ── Required: cache (Redis) ──
  REDIS_URL: z.string().min(1),

  // ── Required: health probe token ──
  HEALTH_TOKEN: z.string().min(1),

  // ── Required: voice token signing ──
  VOICE_TOKEN_SECRET: z.string().min(1),

  // ── Optional: LLM overrides ──
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime"),
  OPENAI_REALTIME_VOICE: z.string().default("marin"),

  // ── Optional: Qdrant collection names ──
  QDRANT_COLLECTION: z.string().default("footnote_chunks"),
  QDRANT_MEMORY_COLLECTION: z.string().default("user_memories"),

  // ── Optional: credits / free-tier window ──
  CREDITS_MAX_PER_WINDOW: coercedNumber.default(200),
  CREDITS_WINDOW_HOURS: coercedNumber.default(6),

  // ── Optional: voice settings ──
  VOICE_TOKEN_TTL_SECONDS: coercedNumber.default(600),
  VOICE_CREDIT_COST_PER_BLOCK: coercedNumber.default(1),
  VOICE_CREDIT_BLOCK_MINUTES: coercedNumber.default(5),
  NEXT_PUBLIC_VOICE_CREDIT_BLOCK_MINUTES: coercedNumber.default(5),
  NEXT_PUBLIC_MAX_SESSION_MINUTES: coercedNumber.optional(),

  // ── Optional: Cloudinary (binary storage) ──
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // ── Optional: Firecrawl (URL extractor) ──
  FIRECRAWL_API_KEY: z.string().optional(),

  // ── Optional: Tavily (web search) ──
  TAVILY_API_KEY: z.string().optional(),
  NEXT_PUBLIC_TAVILY_ENABLED: z.enum(["true", "false"]).default("false"),

  // ── Optional: Stripe (billing) ──
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PACK_STARTER: z.string().optional(),
  STRIPE_PRICE_PACK_PRO: z.string().optional(),
  STRIPE_PRICE_PACK_POWER: z.string().optional(),
  STRIPE_PRICE_PLAN_PLUS: z.string().optional(),
  STRIPE_PRICE_PLAN_PRO: z.string().optional(),

  // ── Optional: Inngest (background jobs) ──
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INNGEST_DEVSERVER_URL: z.string().url().optional(),
  NEXT_PUBLIC_INNGEST_DEVSERVER_URL: z.string().url().optional(),
  REACT_APP_INNGEST_DEVSERVER_URL: z.string().url().optional(),

  // ── Optional: screenshot / web-preview ──
  SEARCHAPI_API_KEY: z.string().optional(),
  YT_PROXY_URL: z.string().optional(),

  // ── App metadata ──
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // ── Security ──
  CSP_ENFORCE: z.enum(["true", "false"]).default("false"),

  // ── Runtime ──
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `❌ Environment validation failed — the app refuses to start with missing/invalid env vars:\n\n${issues}\n\n` +
        "Copy .env.example to .env and fill in the required values. " +
        "Optional values can be left blank.\n"
    );
  }
  return result.data;
}

// Validate only on the server: the browser only ever sees NEXT_PUBLIC_* vars
// (inlined at build time), and re-running the full schema in the client bundle
// would fail for the server-only keys.
const parsed = typeof window === "undefined" ? validateEnv() : (process.env as Record<string, string | undefined>);

function pick(name: keyof typeof parsed, fallback?: string): string | undefined {
  const val = parsed[name];
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

// ── Server-only environment (never import this from a client component) ──
export const serverEnv = {
  database: { url: pick("DATABASE_URL")!, directUrl: pick("DIRECT_URL")! },
  clerk: { secretKey: pick("CLERK_SECRET_KEY")!, webhookSecret: pick("CLERK_WEBHOOK_SECRET") },
  openai: {
    apiKey: pick("OPENAI_API_KEY")!,
    baseUrl: pick("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    chatModel: pick("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini",
    embeddingModel: pick("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
    ttsModel: pick("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
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
    tokenTtlSeconds: Number(parsed.VOICE_TOKEN_TTL_SECONDS ?? 600),
    creditCostPerBlock: Number(parsed.VOICE_CREDIT_BLOCK_MINUTES ?? 1),
    creditBlockMinutes: Number(parsed.VOICE_CREDIT_BLOCK_MINUTES ?? 5),
    maxSessionMinutes: parsed.NEXT_PUBLIC_MAX_SESSION_MINUTES ? Number(parsed.NEXT_PUBLIC_MAX_SESSION_MINUTES) : null,
  },
  credits: {
    maxPerWindow: Number(parsed.CREDITS_MAX_PER_WINDOW ?? 200),
    windowHours: Number(parsed.CREDITS_WINDOW_HOURS ?? 6),
  },
  healthToken: pick("HEALTH_TOKEN")!,
  searchApiKey: pick("SEARCHAPI_API_KEY"),
  ytProxyUrl: pick("YT_PROXY_URL"),
  cspEnforce: parsed.CSP_ENFORCE === "true",
  nodeEnv: parsed.NODE_ENV,
  isProduction: parsed.NODE_ENV === "production",
};

// ── Client-safe environment (only NEXT_PUBLIC_* values) ──
export const clientEnv = {
  appUrl: pick("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  clerkPublishableKey: pick("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")!,
  tavilyEnabled: pick("NEXT_PUBLIC_TAVILY_ENABLED") === "true",
  inngestDevserverUrl: pick("NEXT_PUBLIC_INNGEST_DEVSERVER_URL"),
  voiceCreditBlockMinutes: Number(parsed.NEXT_PUBLIC_VOICE_CREDIT_BLOCK_MINUTES ?? 5),
  maxSessionMinutes: parsed.NEXT_PUBLIC_MAX_SESSION_MINUTES ? Number(parsed.NEXT_PUBLIC_MAX_SESSION_MINUTES) : 60,
};
