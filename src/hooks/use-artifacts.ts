"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type ArtifactType = "SUMMARY" | "TAKEAWAYS" | "FLASHCARDS" | "QUIZ" | "MINDMAP" | "REPORT";
export type ArtifactStatus = "QUEUED" | "GENERATING" | "READY" | "FAILED";

export type ArtifactDTO = {
  id: string;
  notebookId: string;
  type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  errorMessage: string | null;
  sourceIds: string[];
  content: unknown;
  createdAt: string;
  updatedAt: string;
  progress?: { step?: string; percent?: number } | null;
};

const isTerminal = (s: ArtifactStatus) => s === "READY" || s === "FAILED";

/** Fetches a notebook's study artifacts and polls while any are still
 *  QUEUED/GENERATING, same pattern as use-audio-status.ts. */
export function useArtifacts(notebookId: string) {
  const [artifacts, setArtifacts] = useState<ArtifactDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poll = useCallback(
    async (scheduleNext: boolean) => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/artifacts`, { cache: "no-store" });
        if (res.ok) {
          const data: { artifacts: ArtifactDTO[] } = await res.json();
          setArtifacts(data.artifacts);
          const anyInFlight = data.artifacts.some((a) => !isTerminal(a.status));
          if (scheduleNext && anyInFlight) {
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
    setLoading(true);
    poll(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const generate = useCallback(
    async (type: ArtifactType, sourceIds?: string[]) => {
      const res = await fetch(`/api/notebooks/${notebookId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, sourceIds: sourceIds ?? [] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start generation");
      }
      if (timer.current) clearTimeout(timer.current);
      await poll(true);
      return res.headers;
    },
    [notebookId, poll]
  );

  const remove = useCallback(
    async (artifactId: string) => {
      const res = await fetch(`/api/notebooks/${notebookId}/artifacts/${artifactId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete artifact");
      }
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
    },
    [notebookId]
  );

  return { artifacts, loading, generate, remove };
}
