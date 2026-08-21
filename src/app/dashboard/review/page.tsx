"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Flame, Layers, CheckCircle2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useReview, type ReviewGrade } from "@/hooks/use-review";

const GRADE_META: { grade: ReviewGrade; label: string; className: string }[] = [
  { grade: "AGAIN", label: "Again", className: "bg-destructive/10 text-destructive hover:bg-destructive/20" },
  { grade: "HARD", label: "Hard", className: "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" },
  { grade: "GOOD", label: "Good", className: "bg-primary/10 text-primary hover:bg-primary/20" },
  { grade: "EASY", label: "Easy", className: "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20" },
];

export default function ReviewPage() {
  const { queue, stats, loading, submitGrade, submitAnswer, advance } = useReview();
  const [flipped, setFlipped] = useState(false);
  const [answered, setAnswered] = useState<{ selectedIndex: number; correct: boolean; correctIndex: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const current = queue?.[0] ?? null;

  async function handleGrade(grade: ReviewGrade) {
    if (!current) return;
    setSubmitting(true);
    try {
      await submitGrade(current.id, grade);
      setFlipped(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't submit review");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnswer(selectedIndex: number) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitAnswer(current.id, selectedIndex);
      setAnswered({ selectedIndex, ...result });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't submit answer");
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (current) advance(current.id);
    setAnswered(null);
    setFlipped(false);
  }

  return (
    <div className="min-h-screen bg-grid">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-display text-lg font-semibold">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <Logo className="h-5 w-5 text-primary" />
            Review
          </Link>
          {stats && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Flame className="h-3.5 w-3.5 text-primary" /> {stats.streak} day streak
              </span>
              <span className="flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" /> {stats.dueCount} due
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        )}

        {!loading && (!queue || queue.length === 0) && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
            <PartyPopper className="h-8 w-8 text-primary" />
            <h2 className="font-display text-lg font-semibold">You&apos;re all caught up</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Generate flashcards or a quiz from a notebook&apos;s study tools panel, then come back here to review them.
            </p>
            <Link href="/dashboard">
              <Button size="sm" variant="outline">
                Back to notebooks
              </Button>
            </Link>
          </div>
        )}

        {!loading && current && (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-4"
            >
              <p className="text-center text-xs text-muted-foreground">
                {current.notebook.title} · {current.artifact.title}
              </p>

              {current.cardType === "FLASHCARD" ? (
                <>
                  <button
                    onClick={() => setFlipped((v) => !v)}
                    className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center transition-colors hover:bg-secondary/20"
                  >
                    <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {flipped ? "Answer" : "Question"}
                    </div>
                    <div className="font-display text-lg font-medium">{flipped ? current.back : current.front}</div>
                    {!flipped && <p className="mt-4 text-xs text-muted-foreground">Tap to reveal</p>}
                  </button>

                  {flipped && (
                    <div className="grid grid-cols-4 gap-2">
                      {GRADE_META.map((g) => (
                        <Button
                          key={g.grade}
                          disabled={submitting}
                          onClick={() => handleGrade(g.grade)}
                          className={cn("h-10 border-0", g.className)}
                          variant="ghost"
                        >
                          {g.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-border bg-card p-6">
                  <div className="mb-4 font-display text-lg font-medium">{current.front}</div>
                  <div className="space-y-2">
                    {current.options.map((opt, i) => {
                      const isSelected = answered?.selectedIndex === i;
                      const isCorrectOption = answered && i === answered.correctIndex;
                      return (
                        <button
                          key={i}
                          disabled={!!answered || submitting}
                          onClick={() => handleAnswer(i)}
                          className={cn(
                            "w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default",
                            isCorrectOption
                              ? "border-emerald-500/50 bg-emerald-500/10"
                              : isSelected
                              ? "border-destructive/50 bg-destructive/10"
                              : "border-border hover:bg-secondary/30"
                          )}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {answered && (
                    <div className="mt-4 space-y-3">
                      <div className={cn("flex items-center gap-1.5 text-sm font-medium", answered.correct ? "text-emerald-500" : "text-destructive")}>
                        <CheckCircle2 className="h-4 w-4" />
                        {answered.correct ? "Correct" : "Not quite"}
                      </div>
                      {current.explanation && <p className="text-xs text-muted-foreground">{current.explanation}</p>}
                      <Button size="sm" onClick={handleNext} className="w-full">
                        Next card
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
