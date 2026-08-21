/**
 * SM-2 spaced repetition scheduler (the algorithm behind Anki/SuperMemo),
 * simplified to a 4-button grade: Again / Hard / Good / Easy.
 *
 * A card's `easeFactor` grows or shrinks based on how easy the learner found
 * it, and `intervalDays` — the gap until it's due again — grows with each
 * successful review. Getting a card wrong ("Again") resets progress instead
 * of failing forward, which is what makes long-term retention work.
 */

export type ReviewGrade = "AGAIN" | "HARD" | "GOOD" | "EASY";

export type ReviewCardState = {
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
};

const MIN_EASE_FACTOR = 1.3;

export function scheduleNextReview(
    state: ReviewCardState,
    grade: ReviewGrade,
    now: Date = new Date(),
): ReviewCardState & { dueAt: Date } {
    let { easeFactor, intervalDays, repetitions } = state;

    if (grade === "AGAIN") {
        repetitions = 0;
        intervalDays = 1;
        easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
    } else {
        const easeDelta =
            grade === "HARD" ? -0.15 : grade === "EASY" ? 0.15 : 0;
        easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor + easeDelta);

        if (repetitions === 0) {
            intervalDays = grade === "HARD" ? 1 : 1;
        } else if (repetitions === 1) {
            intervalDays = grade === "HARD" ? 3 : 6;
        } else {
            const multiplier =
                grade === "HARD" ? 1.2 : grade === "EASY" ? easeFactor * 1.3 : easeFactor;
            intervalDays = Math.max(1, Math.round(intervalDays * multiplier));
        }

        repetitions += 1;
    }

    const dueAt = new Date(now);
    dueAt.setDate(dueAt.getDate() + intervalDays);

    return { easeFactor, intervalDays, repetitions, dueAt };
}

/** Longest run of consecutive days (ending today or yesterday) with at least one review. */
export function computeStreak(reviewDates: Date[]): number {
    if (reviewDates.length === 0) return 0;

    const days = new Set(
        reviewDates.map((date) => date.toISOString().slice(0, 10)),
    );

    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);

    // A streak "counts" through today even if today hasn't been reviewed
    // yet, so the badge doesn't zero out at midnight before you've had a
    // chance to review — but it does require yesterday if today is empty.
    const todayKey = cursor.toISOString().slice(0, 10);
    if (!days.has(todayKey)) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    let streak = 0;
    while (days.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return streak;
}
