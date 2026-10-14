import { db } from "@/lib/db";
import { computeStreak, scheduleNextReview, type ReviewGrade } from "@/lib/spaced-repetition";
import type { Artifact } from "@prisma/client";

const DEFAULT_QUEUE_LIMIT = 20;
const STREAK_LOOKBACK_DAYS = 60;

/**
 * Creates/refreshes one ReviewCard per flashcard or quiz question whenever a
 * FLASHCARDS or QUIZ artifact finishes generating. Called from the artifact
 * pipeline — never from the client — so review cards always mirror the
 * latest generated deck without the learner doing anything extra.
 *
 * Existing cards keep their SRS progress (upsert only touches content
 * fields); only genuinely new indices start fresh at repetitions: 0.
 */
export async function syncReviewCardsFromArtifact(artifact: Artifact) {
  if (artifact.type !== "FLASHCARDS" && artifact.type !== "QUIZ") return;

  const notebook = await db.notebook.findUnique({
    where: { id: artifact.notebookId },
    select: { ownerId: true },
  });
  if (!notebook) return;
  const userId = notebook.ownerId;

  const rows =
    artifact.type === "FLASHCARDS"
      ? buildFlashcardRows(artifact, userId)
      : buildQuizRows(artifact, userId);

  if (rows.length === 0) return;

  // Fetch existing cards so we can detect whether `front` has changed for
  // each index. When the deck is regenerated with different content at the
  // same index, the old SRS progress (easeFactor, intervalDays, repetitions,
  // dueAt) must NOT carry over to the new question — those answers no
  // longer apply to different content.
  const existing = await db.reviewCard.findMany({
    where: { artifactId: artifact.id, cardIndex: { in: rows.map((r) => r.cardIndex) } },
    select: { cardIndex: true, front: true },
  });
  const frontChanged = new Set(
    existing
      .filter((e) => {
        const newRow = rows.find((r) => r.cardIndex === e.cardIndex);
        return newRow && e.front !== newRow.front;
      })
      .map((e) => e.cardIndex)
  );

  await Promise.all(
    rows.map((row) =>
      db.reviewCard.upsert({
        where: { artifactId_cardIndex: { artifactId: row.artifactId, cardIndex: row.cardIndex } },
        update: {
          front: row.front,
          back: row.back,
          options: row.options ?? [],
          correctIndex: row.correctIndex,
          explanation: row.explanation,
          ...(frontChanged.has(row.cardIndex)
            ? { easeFactor: 2.5, intervalDays: 0, repetitions: 0, dueAt: new Date(), lastReviewedAt: null, lastGrade: null }
            : {}),
        },
        create: row,
      })
    )
  );

  // If the deck shrank on regeneration, drop the now-orphaned tail cards.
  await db.reviewCard.deleteMany({
    where: { artifactId: artifact.id, cardIndex: { gte: rows.length } },
  });
}

type ReviewCardRow = {
  userId: string;
  notebookId: string;
  artifactId: string;
  cardIndex: number;
  cardType: "FLASHCARD" | "QUIZ";
  front: string;
  back: string;
  options: string[];
  correctIndex: number | null;
  explanation: string | null;
};

function buildFlashcardRows(artifact: Artifact, userId: string): ReviewCardRow[] {
  const content = artifact.content as { cards?: { front: string; back: string }[] } | null;
  const cards = content?.cards ?? [];
  return cards.map((card, index) => ({
    userId,
    notebookId: artifact.notebookId,
    artifactId: artifact.id,
    cardIndex: index,
    cardType: "FLASHCARD",
    front: card.front,
    back: card.back,
    options: [],
    correctIndex: null,
    explanation: null,
  }));
}

function buildQuizRows(artifact: Artifact, userId: string): ReviewCardRow[] {
  const content = artifact.content as
    | { questions?: { question: string; options: string[]; correctIndex: number; explanation: string }[] }
    | null;
  const questions = content?.questions ?? [];
  return questions.map((q, index) => {
    const options = q.options ?? [];
    const safeCorrectIndex =
      Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length
        ? q.correctIndex
        : null;
    return {
      userId,
      notebookId: artifact.notebookId,
      artifactId: artifact.id,
      cardIndex: index,
      cardType: "QUIZ" as const,
      front: q.question,
      back: options[safeCorrectIndex ?? 0] ?? "",
      options: options,
      correctIndex: safeCorrectIndex,
      explanation: q.explanation,
    };
  });
}

/** Builds a review session: cards already due first (oldest-due first),
 *  then tops up with never-reviewed cards so a fresh deck still produces
 *  a session before anything is technically "due". */
export async function getReviewQueue(userId: string, limit = DEFAULT_QUEUE_LIMIT) {
  const now = new Date();

  const due = await db.reviewCard.findMany({
    where: { userId, dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: limit,
    include: { artifact: { select: { title: true } }, notebook: { select: { id: true, title: true } } },
  });

  if (due.length >= limit) return due;

  const fresh = await db.reviewCard.findMany({
    where: { userId, repetitions: 0, dueAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    take: limit - due.length,
    include: { artifact: { select: { title: true } }, notebook: { select: { id: true, title: true } } },
  });

  return [...due, ...fresh];
}

export async function getReviewStats(userId: string) {
  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - STREAK_LOOKBACK_DAYS);

  const [due, total, reviewedToday, recentLogs] = await Promise.all([
    db.reviewCard.count({ where: { userId, dueAt: { lte: now } } }),
    db.reviewCard.count({ where: { userId } }),
    db.reviewLog.count({ where: { userId, reviewedAt: { gte: startOfDay } } }),
    db.reviewLog.findMany({ where: { userId, reviewedAt: { gte: since } }, select: { reviewedAt: true } }),
  ]);

  const streak = computeStreak(recentLogs.map((l: { reviewedAt: Date }) => l.reviewedAt));

  return { dueCount: due, totalCards: total, reviewedToday, streak };
}

async function applySchedule(userId: string, cardId: string, grade: ReviewGrade) {
  const card = await db.reviewCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId) throw new Error("Review card not found");

  const now = new Date();
  const next = scheduleNextReview(
    { easeFactor: card.easeFactor, intervalDays: card.intervalDays, repetitions: card.repetitions },
    grade,
    now
  );

  const [updated] = await Promise.all([
    db.reviewCard.update({
      where: { id: card.id },
      data: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        dueAt: next.dueAt,
        lastReviewedAt: now,
        lastGrade: grade,
      },
    }),
    db.reviewLog.create({ data: { userId, cardId: card.id, grade } }),
  ]);

  return updated;
}

/** Grades a FLASHCARD card and reschedules it via SM-2. */
export async function submitReview(userId: string, cardId: string, grade: ReviewGrade) {
  const card = await db.reviewCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId) throw new Error("Review card not found");
  if (card.cardType !== "FLASHCARD") {
    throw new Error("This is a quiz card — submit an answer instead of a grade");
  }
  return applySchedule(userId, cardId, grade);
}

/** Grades a QUIZ card objectively: correctness against `correctIndex` maps
 *  to GOOD (correct) or AGAIN (incorrect), then reschedules via the same
 *  SM-2 curve as flashcards. */
export async function submitQuizAnswer(userId: string, cardId: string, selectedIndex: number) {
  const card = await db.reviewCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId) throw new Error("Review card not found");
  if (card.cardType !== "QUIZ") {
    throw new Error("This is a flashcard — submit a grade instead of an answer");
  }
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= card.options.length) {
    throw new Error("selectedIndex is out of range");
  }

  const correct = selectedIndex === card.correctIndex;
  const grade: ReviewGrade = correct ? "GOOD" : "AGAIN";
  const updated = await applySchedule(userId, cardId, grade);

  return { card: updated, correct, correctIndex: card.correctIndex };
}
