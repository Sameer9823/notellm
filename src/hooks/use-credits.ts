"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CreditsInfo = {
  balance: number;
  max: number;
  /** Epoch ms the balance will next refresh to `max`. */
  resetAt: number;
  windowHours: number;
};

const POLL_MS = 15_000;

/**
 * Polls /api/credits on an interval so the credits badge stays roughly
 * live even if nothing in this tab spends a credit. Callers that *do*
 * spend a credit (asking a question, uploading a source, generating audio
 * or a roadmap) should call `refresh()` right after so the badge updates
 * immediately instead of waiting for the next poll tick.
 */
export function useCredits() {
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/credits", { cache: "no-store" });
      if (res.ok) {
        const data: { credits: CreditsInfo } = await res.json();
        setCredits(data.credits);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    function schedule() {
      timer.current = setTimeout(async () => {
        await refresh();
        schedule();
      }, POLL_MS);
    }
    schedule();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  /** Applies the X-Credits-* headers from a fetch response directly, so a
   *  component that already made the request doesn't have to wait for a
   *  fresh /api/credits round trip just to reflect what it already knows. */
  const applyHeaders = useCallback((headers: Headers) => {
    const balance = headers.get("X-Credits-Balance");
    const max = headers.get("X-Credits-Max");
    const resetAt = headers.get("X-Credits-Reset");
    if (balance == null || max == null || resetAt == null) return;
    setCredits((prev) => ({
      balance: Number(balance),
      max: Number(max),
      resetAt: Number(resetAt),
      windowHours: prev?.windowHours ?? 6,
    }));
  }, []);

  return { credits, loading, refresh, applyHeaders };
}
