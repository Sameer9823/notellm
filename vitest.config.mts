import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    env: {
      // Required server env vars (dummy values — tests don't make real calls)
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      DIRECT_URL: "postgresql://user:pass@host:5432/db",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
      CLERK_SECRET_KEY: "sk_test_dummy",
      OPENAI_API_KEY: "sk-test-dummy-key",
      QDRANT_URL: "http://localhost:6333",
      QDRANT_API_KEY: "dummy-key",
      REDIS_URL: "redis://localhost:6379",
      HEALTH_TOKEN: "test-health-token",
      VOICE_TOKEN_SECRET: "test-voice-secret",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
  },
});
