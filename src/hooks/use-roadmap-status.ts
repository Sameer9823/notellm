"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RoadmapDTO } from "@/types";

type StatusResponse = {
  roadmap: RoadmapDTO | null;
  progress?: { step?: string; percent?: number } | null;
  videoCount: number;
};

/** Polls a notebook's latest learning roadmap every 2s while generation is
 *  in-flight, and stops automatically once it reaches a terminal state.
 *  Mirrors use-audio-status.ts. */
export function useRoadmapStatus(notebookId: string, refreshSignal?: number) {
  const [roadmap, setRoadmap] = useState<RoadmapDTO | null>(null);
  const [videoCount, setVideoCount] = useState(0);
  const [step, setStep] = useState<string | undefined>();
  const [percent, setPercent] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isTerminal = (s?: RoadmapDTO["status"]) => s === "READY" || s === "FAILED";

  const poll = useCallback(
    async (scheduleNext: boolean) => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/roadmap`, { cache: "no-store" });
        if (res.ok) {
          const data: StatusResponse = await res.json();
          setRoadmap(data.roadmap);
          setVideoCount(data.videoCount);
          setStep(data.progress?.step);
          setPercent(data.progress?.percent ?? (data.roadmap?.status === "READY" ? 100 : 0));
          if (scheduleNext && data.roadmap && !isTerminal(data.roadmap.status)) {
            timer.current = setTimeout(() => poll(true), 2000);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [notebookId]
  );

  useEffect(() => {
    poll(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // refreshSignal is bumped by the parent page whenever a linked YouTube
    // source flips to READY, so this effect re-fires and fetches a fresh
    // videoCount instead of relying on the one-shot poll from mount (which
    // otherwise never re-runs once a roadmap request settles into a
    // terminal state, or if no roadmap has ever been generated yet).
  }, [poll, refreshSignal]);

  const startGeneration = useCallback(async () => {
    const res = await fetch(`/api/notebooks/${notebookId}/roadmap`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to start roadmap generation");
    }
    if (timer.current) clearTimeout(timer.current);
    poll(true);
  }, [notebookId, poll]);

  const deleteRoadmap = useCallback(async () => {
    if (!roadmap) return;
    const res = await fetch(`/api/notebooks/${notebookId}/roadmap/${roadmap.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete roadmap");
    }
    if (timer.current) clearTimeout(timer.current);
    setRoadmap(null);
    setStep(undefined);
    setPercent(0);
  }, [notebookId, roadmap]);

  return { roadmap, videoCount, step, percent, loading, startGeneration, deleteRoadmap };
}