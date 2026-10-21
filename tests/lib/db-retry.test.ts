import { describe, it, expect } from "vitest";
import { isTransientDbError, withDbRetry, TRANSACTION_DEFAULTS } from "../../src/lib/db";

describe("transaction defaults", () => {
  it("allows more than Prisma's 5s default for pooled remote Postgres", () => {
    // Prisma's own defaults are maxWait 2s / timeout 5s, which a bulk chunk
    // insert over the Neon pooler blows through (measured ~10s for a few
    // hundred chunks).
    expect(TRANSACTION_DEFAULTS.timeout).toBeGreaterThan(5_000);
    expect(TRANSACTION_DEFAULTS.maxWait).toBeGreaterThan(2_000);
  });
});

describe("isTransientDbError", () => {
  it("treats dropped pooled connections as transient", () => {
    expect(
      isTransientDbError({
        code: "P1001",
        message: "Can't reach database server at `ep-iced-pooler.aws.neon.tech:5432`",
      })
    ).toBe(true);
    expect(isTransientDbError(new Error("Connection reset by peer"))).toBe(true);
    expect(isTransientDbError(new Error("ECONNRESET"))).toBe(true);
    expect(isTransientDbError(new Error("server closed the connection unexpectedly"))).toBe(true);
  });

  it("treats logical errors as permanent", () => {
    expect(isTransientDbError({ code: "P2002", message: "Unique constraint failed" })).toBe(false);
    expect(isTransientDbError(new Error("No indexed sources are available to summarize yet"))).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns the result without retrying when the operation succeeds", async () => {
    let calls = 0;
    const result = await withDbRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("Can't reach database server at `neon:5432`");
        return "recovered";
      },
      { attempts: 5, baseDelayMs: 1 }
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("does not retry a permanent failure", async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new Error("Unique constraint failed on the constraints");
        },
        { attempts: 5, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/Unique constraint/);
    expect(calls).toBe(1);
  });

  it("gives up after the configured number of attempts", async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new Error("Can't reach database server at `neon:5432`");
        },
        { attempts: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/Can't reach database server/);
    expect(calls).toBe(3);
  });
});
