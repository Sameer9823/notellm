import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToolToken, verifyToolToken } from "../../src/lib/voice/server-config";

describe("tool token", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.VOICE_TOKEN_SECRET = "test-secret-123";
  });

  afterEach(() => {
    delete process.env.VOICE_TOKEN_SECRET;
  });

  it("signs and verifies a token", async () => {
    const mod = await import("../../src/lib/voice/server-config");
    const payload = { userId: "user_1", notebookId: "nb_1", sessionId: "sess_1" };
    const token = mod.signToolToken(payload);
    const result = mod.verifyToolToken(token);
    expect(result).not.toBeNull();
    expect(result!.payload.userId).toBe("user_1");
    expect(result!.payload.notebookId).toBe("nb_1");
    expect(result!.payload.sessionId).toBe("sess_1");
    expect(typeof result!.payload.exp).toBe("number");
  });

  it("rejects a forged token", async () => {
    const mod = await import("../../src/lib/voice/server-config");
    const forged = "eyJ." + btoa(JSON.stringify({ userId: "x", notebookId: "y", sessionId: "z", exp: 9999999999 })).replace(/=/g, "") + ".badsig";
    expect(mod.verifyToolToken(forged)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const mod = await import("../../src/lib/voice/server-config");
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const payload = JSON.stringify({ userId: "user_1", notebookId: "nb_1", sessionId: "sess_1", exp: pastExp });
    const sig = await import("node:crypto").then((c) => c.createHmac("sha256", "test-secret-123").update(payload).digest("base64url"));
    const token = Buffer.from(payload).toString("base64") + "." + sig;
    expect(mod.verifyToolToken(token)).toBeNull();
  });

  it("rejects a token for another user's notebook", async () => {
    const mod = await import("../../src/lib/voice/server-config");
    const token = mod.signToolToken({ userId: "user_1", notebookId: "nb_1", sessionId: "sess_1" });
    const result = mod.verifyToolToken(token);
    expect(result!.payload.userId).toBe("user_1");
    expect(result!.payload.notebookId).toBe("nb_1");
  });
});
