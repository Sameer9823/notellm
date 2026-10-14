import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { flashcardsSchema, quizSchema, mindmapSchema, takeawaysSchema } from "../../src/lib/artifact-schemas";

function makeFlashcards(n: number) {
  return { cards: Array.from({ length: n }, (_, i) => ({ front: `Q${i}?`, back: `A${i}.` })) };
}

function makeTakeaways(n: number) {
  return { items: Array.from({ length: n }, (_, i) => `Takeaway ${i}`) };
}

function makeQuizQuestion(i: number, opts = 4, correctIndex = 0) {
  return {
    question: `Question ${i}?`,
    options: Array.from({ length: opts }, (_, j) => `Option ${j}`),
    correctIndex,
    explanation: `Explanation ${i}`,
  };
}

describe("artifact schemas", () => {
  it("31 flashcards truncates to 30", () => {
    const parsed = flashcardsSchema.parse(makeFlashcards(31));
    expect(parsed.cards).toHaveLength(30);
  });

  it("2 flashcards fails", () => {
    expect(() => flashcardsSchema.parse(makeFlashcards(2))).toThrow(ZodError);
  });

  it("quiz with out-of-range correctIndex drops that question", () => {
    const input = {
      questions: [
        makeQuizQuestion(0, 4, 0),
        makeQuizQuestion(1, 4, 7),
        makeQuizQuestion(2, 4, 0),
        makeQuizQuestion(3, 4, 0),
      ],
    };
    const parsed = quizSchema.parse(input);
    expect(parsed.questions).toHaveLength(3);
    expect(parsed.questions.map((q) => q.question)).toEqual(["Question 0?", "Question 2?", "Question 3?"]);
  });

  it("16 quiz questions truncates to 15", () => {
    const input = { questions: Array.from({ length: 16 }, (_, i) => makeQuizQuestion(i)) };
    const parsed = quizSchema.parse(input);
    expect(parsed.questions).toHaveLength(15);
  });

  it("mind map with dangling edge keeps nodes and drops the edge", () => {
    const input = {
      nodes: [
        { id: "1", label: "Central topic" },
        { id: "2", label: "Subtopic A" },
      ],
      edges: [
        { id: "e1", source: "1", target: "2" },
        { id: "e2", source: "1", target: "999" },
        { id: "e3", source: "2", target: "2" },
      ],
    };
    const parsed = mindmapSchema.parse(input);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].id).toBe("e1");
  });

  it("35 takeaways truncates to 20", () => {
    const parsed = takeawaysSchema.parse(makeTakeaways(35));
    expect(parsed.items).toHaveLength(20);
  });

  it("2 takeaways fails", () => {
    expect(() => takeawaysSchema.parse(makeTakeaways(2))).toThrow(ZodError);
  });
});
