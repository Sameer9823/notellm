import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncate(text: string, max = 140) {
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/** Node/undici often wraps real network errors (DNS failure, connection
 *  refused, TLS issues) inside a generic top-level message and puts the
 *  actual reason on `.cause`. Unwrap it so logs/UI show something useful
 *  instead of just "fetch failed". */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 3) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as { cause?: unknown }).cause;
    } else {
      parts.push(String(cause));
      cause = undefined;
    }
    depth++;
  }
  return parts.filter(Boolean).join(" — caused by: ");
}