/**
 * Centralized outbound-call reliability layer.
 *
 * Provides three composable primitives for external dependencies (OpenAI,
 * Tavily, Firecrawl, Cloudinary, etc.) that may be slow or flaky:
 *
 *  1. `withTimeout` — aborts a promise after `ms`, racing against a fallback.
 *  2. `withRetry`   — retries transient errors (429, 5xx, network) with
 *     exponential backoff + jitter. 4xx (non-429) errors fail fast.
 *  3. `CircuitBreaker` — trips open after N consecutive failures, giving
 *     the downstream service time to recover before half-open probes resume
 *     traffic. Fails fast (open state) or fails closed (tripped) so callers
 *     can degrade gracefully.
 *
 * All three are framework-agnostic: they wrap any `Promise<T>` or `fetch`.
 *
 * Usage:
 *   const breaker = new CircuitBreaker("tavily", { failureThreshold: 5, halfOpenAttempts: 1 });
 *   const res = await breaker.call(() => withTimeout(withRetry(() => fetchApi(), { attempts: 3 }), 20000));
 */

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Aborts `promise` after `ms` milliseconds via AbortController, producing a
 *  TimeoutError. Non-abortable operations still race against the timer. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let controller: AbortController;
  try {
    controller = new AbortController();
  } catch {
    // AbortController not available (extremely old runtime) — just return the
    // raw promise. The caller's own signal handling is the last line of defense.
    return promise;
  }

  const timeout = setTimeout(() => controller.abort(), ms);

  return Promise.race([
    promise.then(
      (val) => (clearTimeout(timeout), val),
      (err) => (clearTimeout(timeout), Promise.reject(err))
    ),
    new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        clearTimeout(timeout);
        reject(new TimeoutError(`Operation timed out after ${ms}ms`));
      } else {
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(new TimeoutError(`Operation timed out after ${ms}ms`));
          },
          { once: true }
        );
      }
    }),
  ]);
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** HTTP statuses (or `undefined` for network errors) that trigger a retry. */
  retryableStatuses?: Set<number>;
  /** Optional predicate for fine-grained error classification. */
  isRetryable?: (err: unknown) => boolean;
}

const DEFAULT_RETRYABLE = new Set([408, 429, 502, 503, 504]);

/** Retries `fn` on transient failures with exponential backoff + jitter.
 *  Non-retryable errors are thrown immediately. Network errors (no status)
 *  are retried because they're usually temporary DNS/timeouts. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 500,
    retryableStatuses = DEFAULT_RETRYABLE,
    isRetryable,
  }: RetryOptions = {}
): Promise<T> {
  if (attempts < 1) throw new Error("withRetry: attempts must be >= 1");
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const retriable = isRetryable
        ? isRetryable(err)
        : status === undefined || retryableStatuses.has(status);
      if (!retriable || i === attempts - 1) throw err;
      const delay = baseDelayMs * 2 ** i + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Circuit-breaker states. */
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  halfOpenAttempts?: number;
  /** Log state transitions when true (useful in dev/staging). */
  monitor?: boolean;
}

export class CircuitBreaker {
  state: CircuitState = "closed";
  private failures = 0;
  private nextAttemptAt = 0;
  private halfOpenCount = 0;

  constructor(public name: string, private opts: CircuitBreakerOptions) {}

  get isOpen(): boolean {
    return this.state === "open";
  }

  /** Executes `fn` through the circuit breaker.
   *  - CLOSED:  calls `fn`; on failure increments counter; trips open after threshold.
   *  - OPEN:    rejects immediately until `recoveryTimeoutMs` elapses; then goes half-open.
   *  - HALF-OPEN: allows up to `halfOpenAttempts` test calls; all succeed → close; one fails → re-open. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.state === "open") {
      if (now < this.nextAttemptAt) {
        throw new Error(`CircuitBreaker "${this.name}" is open`);
      }
      this.state = "half-open";
      this.halfOpenCount = 0;
      if (this.opts.monitor) console.warn(`[circuit-breaker] ${this.name} → half-open`);
    }

    const maxHalfOpen = this.opts.halfOpenAttempts ?? 1;
    if (this.state === "half-open" && this.halfOpenCount >= maxHalfOpen) {
      throw new Error(`CircuitBreaker "${this.name}" is half-open (limit reached)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.state = "closed";
      this.failures = 0;
      if (this.opts.monitor) console.warn(`[circuit-breaker] ${this.name} → closed (recovered)`);
    } else if (this.failures > 0) {
      this.failures--;
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.opts.monitor) console.warn(`[circuit-breaker] ${this.name} failure #${this.failures}`);

    if (this.state === "half-open") {
      this.state = "open";
      this.nextAttemptAt = Date.now() + this.opts.recoveryTimeoutMs;
      if (this.opts.monitor) console.warn(`[circuit-breaker] ${this.name} → open (half-open probe failed)`);
    } else if (this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.nextAttemptAt = Date.now() + this.opts.recoveryTimeoutMs;
      if (this.opts.monitor) console.warn(`[circuit-breaker] ${this.name} → open (threshold reached)`);
    }
  }

  /** Resets the breaker to CLOSED with zero failures. Useful for tests. */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.halfOpenCount = 0;
  }
}
