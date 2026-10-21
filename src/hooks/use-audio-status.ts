"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AudioOverviewDTO } from "@/types";

type StatusResponse = {
  overview: AudioOverviewDTO | null;
  progress?: { step?: string; percent?: number } | null;
};

/** Polls a notebook's latest audio overview every 2s while generation is
 *  in-flight, and stops automatically once it reaches a terminal state.
 *  When `sourceId` is set, everything (poll/generate/delete) is scoped to
 *  that single source's own podcast instead of the notebook-wide one. */
export function useAudioStatus(notebookId: string, sourceId?: string | null) {
  const [overview, setOverview] = useState<AudioOverviewDTO | null>(null);
  const [step, setStep] = useState<string | undefined>();
  const [percent, setPercent] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failureCount = useRef(0);

  const POLL_INTERVAL_MS = 2000;
  const RETRY_DELAY_MS = 3000;
  const MAX_FAILURES = 5;

  const isTerminal = (s?: AudioOverviewDTO["status"]) => s === "READY" || s === "FAILED";

  const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";

  const poll = useCallback(
    async (scheduleNext: boolean) => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/audio${query}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: StatusResponse = await res.json();
        setOverview(data.overview);
        setStep(data.progress?.step);
        setPercent(data.progress?.percent ?? (data.overview?.status === "READY" ? 100 : 0));
        failureCount.current = 0; // reset on success
        if (scheduleNext && data.overview && !isTerminal(data.overview.status)) {
          timer.current = setTimeout(() => poll(true), POLL_INTERVAL_MS);
        }
      } catch {
        // Non-OK response or network error — retry instead of stopping forever.
        failureCount.current++;
        if (failureCount.current <= MAX_FAILURES) {
          timer.current = setTimeout(() => poll(scheduleNext), RETRY_DELAY_MS);
        }
      } finally {
        setLoading(false);
      }
    },
    [notebookId, query]
  );

  useEffect(() => {
    setLoading(true);
    setOverview(null);
    setStep(undefined);
    setPercent(0);
    failureCount.current = 0;
    poll(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const startGeneration = useCallback(
    async (voices?: { voiceA?: string; voiceB?: string }) => {
      const res = await fetch(`/api/notebooks/${notebookId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(voices ?? {}), sourceId: sourceId ?? null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start audio generation");
      }
      if (timer.current) clearTimeout(timer.current);
      poll(true);
    },
    [notebookId, sourceId, poll]
  );

  const deleteOverview = useCallback(async () => {
    if (!overview) return;
    const res = await fetch(`/api/notebooks/${notebookId}/audio/${overview.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete audio overview");
    }
    if (timer.current) clearTimeout(timer.current);
    setOverview(null);
    setStep(undefined);
    setPercent(0);
  }, [notebookId, overview]);

  return { overview, step, percent, loading, startGeneration, deleteOverview };
}