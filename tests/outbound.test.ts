import { describe, it, expect, vi } from "vitest";
import {
  withTimeout,
  TimeoutError,
  withRetry,
  CircuitBreaker,
} from "@/lib/outbound";

describe("withTimeout", () => {
  it("resolves on time", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("rejects with TimeoutError when the promise is too slow", async () => {
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error("rejected")), 50));
    await expect(withTimeout(slow, 10)).rejects.toThrow(TimeoutError);
  });

  it("propagates non-timeout rejections", async () => {
    const fast = Promise.reject(new Error("boom"));
    await expect(withTimeout(fast, 1000)).rejects.toThrow("boom");
  });
});

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { attempts: 3 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable status and eventually succeeds", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce("ok");
    expect(await withRetry(fn, { attempts: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network error (no status)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce("ok");
    expect(await withRetry(fn, { attempts: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fails fast on non-retryable 4xx", async () => {
    const err404 = Object.assign(new Error("not found"), { status: 404 });
    const fn = vi.fn().mockRejectedValue(err404);
    await expect(withRetry(fn, { attempts: 3 })).rejects.toThrow("not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries and throws last error", async () => {
    const err503 = Object.assign(new Error("unavailable"), { status: 503 });
    const fn = vi.fn().mockRejectedValue(err503);
    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow("unavailable");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects with attempts < 1", async () => {
    await expect(withRetry(vi.fn(), { attempts: 0 })).rejects.toThrow("attempts must be >= 1");
  });
});

describe("CircuitBreaker", () => {
  it("calls fn and returns result in closed state", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3, recoveryTimeoutMs: 50, monitor: false });
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await breaker.call(fn)).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("opens after failureThreshold consecutive failures", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3, recoveryTimeoutMs: 50, monitor: false });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.call(fn)).rejects.toThrow("fail");
    await expect(breaker.call(fn)).rejects.toThrow("fail");
    expect(breaker.state).toBe("closed");

    await expect(breaker.call(fn)).rejects.toThrow("fail");
    expect(breaker.state).toBe("open");
    expect(breaker.isOpen).toBe(true);
  });

  it("rejects immediately when open (before recovery)", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, recoveryTimeoutMs: 5000, monitor: false });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(breaker.call(fn)).rejects.toThrow("fail");
    expect(breaker.state).toBe("open");

    // Should not call fn at all — should fail fast
    await expect(breaker.call(fn)).rejects.toThrow('CircuitBreaker "test" is open');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("transitions to half-open and closes on success after recovery", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, recoveryTimeoutMs: 50, monitor: false });

    await expect(breaker.call(vi.fn().mockRejectedValue(new Error("fail")))).rejects.toThrow("fail");
    expect(breaker.state).toBe("open");

    // Wait for recovery
    await new Promise((r) => setTimeout(r, 100));

    const fn = vi.fn().mockResolvedValue("recovered");
    expect(await breaker.call(fn)).toBe("recovered");
    expect(breaker.state).toBe("closed");
  });

  it("re-opens if half-open probe fails", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, recoveryTimeoutMs: 50, monitor: false });

    await expect(breaker.call(vi.fn().mockRejectedValue(new Error("fail")))).rejects.toThrow("fail");
    expect(breaker.state).toBe("open");

    await new Promise((r) => setTimeout(r, 100));

    // The first call after recovery transitions to half-open, then the probe fails
    await expect(breaker.call(vi.fn().mockRejectedValue(new Error("fail")))).rejects.toThrow("fail");
    expect(breaker.state).toBe("open");
  });

  it("resets to closed via reset()", () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 1, recoveryTimeoutMs: 10, monitor: false });
    // Trigger a failure to put the breaker in a known state
    breaker.call(vi.fn().mockRejectedValue(new Error("fail"))).catch(() => {});
    breaker.reset();
    expect(breaker.state).toBe("closed");
    expect(breaker.isOpen).toBe(false);
  });

  it("counts consecutive successes to recover partial failures", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3, recoveryTimeoutMs: 50, monitor: false });
    const fail = Object.assign(new Error("fail"), { status: 503 });

    // Fail twice (doesn't trip yet)
    await expect(breaker.call(vi.fn().mockRejectedValueOnce(fail))).rejects.toThrow("fail");
    await expect(breaker.call(vi.fn().mockRejectedValueOnce(fail))).rejects.toThrow("fail");
    expect(breaker.state).toBe("closed");

    // Then succeed — should close
    await breaker.call(vi.fn().mockResolvedValue("ok"));
    expect(breaker.state).toBe("closed");
  });

  it("resets failure count after success in closed state", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 3, recoveryTimeoutMs: 50, monitor: false });

    // Fail twice
    await expect(breaker.call(vi.fn().mockRejectedValue(Object.assign(new Error("fail"), { status: 503 })))).rejects.toThrow("fail");
    await expect(breaker.call(vi.fn().mockRejectedValue(Object.assign(new Error("fail"), { status: 503 })))).rejects.toThrow("fail");

    // Succeed — failure count should reset
    await breaker.call(vi.fn().mockResolvedValue("ok"));

    // Should be able to fail once more without tripping (count starts at 0)
    await expect(breaker.call(vi.fn().mockRejectedValue(Object.assign(new Error("fail"), { status: 503 })))).rejects.toThrow("fail");
    expect(breaker.state).toBe("closed");
  });
});
