"use client";

import { useCallback, useEffect, useState } from "react";

export type ReviewGrade = "AGAIN" | "HARD" | "GOOD" | "EASY";

export type ReviewCardDTO = {
  id: string;
  notebookId: string;
  artifactId: string;
  cardType: "FLASHCARD" | "QUIZ";
  front: string;
  back: string;
  options: string[];
  correctIndex: number | null;
  explanation: string | null;
  dueAt: string;
  notebook: { id: string; title: string };
  artifact: { title: string };
};

export type ReviewStats = { dueCount: number; totalCards: number; reviewedToday: number; streak: number };

export function useReview() {
  const [queue, setQueue] = useState<ReviewCardDTO[] | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueRes, statsRes] = await Promise.all([
        fetch("/api/review/queue", { cache: "no-store" }),
        fetch("/api/review/stats", { cache: "no-store" }),
      ]);
      if (queueRes.ok) setQueue((await queueRes.json()).queue);
      if (statsRes.ok) setStats((await statsRes.json()).stats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitGrade = useCallback(async (cardId: string, grade: ReviewGrade) => {
    const res = await fetch(`/api/review/${cardId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to submit review");
    }
    setQueue((prev) => (prev ? prev.filter((c) => c.id !== cardId) : prev));
  }, []);

  const submitAnswer = useCallback(async (cardId: string, selectedIndex: number) => {
    const res = await fetch(`/api/review/${cardId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedIndex }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to submit answer");
    }
    const data: { correct: boolean; correctIndex: number } = await res.json();
    // Deliberately does NOT remove the card from `queue` yet — the review
    // page keeps showing this card (with the answer revealed) until the
    // user taps "Next card", which calls `advance()` below.
    return data;
  }, []);

  const advance = useCallback((cardId: string) => {
    setQueue((prev) => (prev ? prev.filter((c) => c.id !== cardId) : prev));
  }, []);

  return { queue, stats, loading, reload: load, submitGrade, submitAnswer, advance };
}
