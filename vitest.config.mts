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
      OPENAI_API_KEY: "test-key-not-real",
      QDRANT_URL: "http://localhost:6333",
      REDIS_URL: "redis://localhost:6379",
    },
  },
});
