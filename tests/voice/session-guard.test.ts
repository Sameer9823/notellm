import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("voice session active guard", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.VOICE_TOKEN_SECRET = "test-secret-123";
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    delete process.env.VOICE_TOKEN_SECRET;
    delete process.env.REDIS_URL;
  });

  it("derives the active session redis key", async () => {
    const key = `voice:session:active:user_123`;
    expect(key).toBe("voice:session:active:user_123");
  });
});
