"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  GraduationCap,
  Loader2,
  FileText,
  ListChecks,
  Layers,
  HelpCircle,
  Network,
  ScrollText,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Check,
  Shuffle,
  RotateCw,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useArtifacts, type ArtifactDTO, type ArtifactType } from "@/hooks/use-artifacts";
import { StudioTabs, type StudioTabId } from "./StudioTabs";
import { MindMapViewer } from "./MindMapViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TYPE_META: Record<ArtifactType, { label: string; icon: typeof FileText; blurb: string }> = {
  SUMMARY: { label: "Summary", icon: FileText, blurb: "A markdown summary of your sources" },
  TAKEAWAYS: { label: "Key takeaways", icon: ListChecks, blurb: "Concise bullet-point highlights" },
  FLASHCARDS: { label: "Flashcards", icon: Layers, blurb: "Study cards, reviewable with spaced repetition" },
  QUIZ: { label: "Quiz", icon: HelpCircle, blurb: "Multiple-choice questions with explanations" },
  MINDMAP: { label: "Mind map", icon: Network, blurb: "Concepts as connected nodes" },
  REPORT: { label: "Report", icon: ScrollText, blurb: "A structured long-form write-up" },
};

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  GENERATING: "Generating",
  READY: "Ready",
  FAILED: "Failed",
};

export function ArtifactsPanel({
  notebookId,
  hasReadySources,
  open,
  onClose,
  onSwitchTab,
}: {
  notebookId: string;
  hasReadySources: boolean;
  open: boolean;
  onClose: () => void;
  onSwitchTab?: (id: StudioTabId) => void;
}) {
  if (!open) return null;
  const { artifacts, loading, generate, remove } = useArtifacts(notebookId);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState<ArtifactType | null>(null);
  const [selected, setSelected] = useState<ArtifactDTO | null>(null);

  async function handleGenerate(type: ArtifactType) {
    setStarting(type);
    try {
      await generate(type);
      setPicking(false);
      toast.success(`Generating ${TYPE_META[type].label.toLowerCase()}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start generation");
    } finally {
      setStarting(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this artifact? This can't be undone.")) return;
    try {
      await remove(id);
      if (selected?.id === id) setSelected(null);
      toast.success("Artifact deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete artifact");
    }
  }

  return (
    <>
      <div className="flex h-full flex-col min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Study tools</span>
          </div>
          <div className="flex items-center gap-1">
            {!picking && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setPicking(true)} title="Generate new">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {onSwitchTab && <StudioTabs active="study" onSelect={onSwitchTab} />}

        <ScrollArea className="flex-1">
          <div className="p-4">
            {picking ? (
              <TypePicker hasReadySources={hasReadySources} starting={starting} onPick={handleGenerate} onCancel={() => setPicking(false)} />
            ) : loading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : artifacts.length === 0 ? (
              <EmptyState hasReadySources={hasReadySources} onGenerate={() => setPicking(true)} />
            ) : (
              <div className="space-y-2">
                {artifacts.map((a) => (
                  <ArtifactRow key={a.id} artifact={a} onOpen={() => setSelected(a)} onDelete={() => handleDelete(a.id)} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Full-screen artifact viewer: opened whenever an artifact row is
          clicked, regardless of type. Replaces the old behavior of cramming
          content (especially the mind map graph) into the 380px sidebar.
          Lives outside the panel — it's an unrelated overlay, not part of
          the sidebar content. */}
      <Dialog open={Boolean(selected)} onOpenChange={(next) => !next && setSelected(null)}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col overflow-hidden p-0">
          {selected && (
            <>
              <DialogHeader className="border-b border-border px-6 py-4">
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = TYPE_META[selected.type].icon;
                    return <Icon className="h-4 w-4 text-primary" />;
                  })()}
                  {selected.title}
                </DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto p-6">
                <ArtifactViewer artifact={selected} notebookId={notebookId} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyState({ hasReadySources, onGenerate }: { hasReadySources: boolean; onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <GraduationCap className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h4 className="font-display text-sm font-semibold">Turn your sources into study tools</h4>
        <p className="mx-auto mt-1 max-w-[240px] text-xs text-muted-foreground">
          {hasReadySources
            ? "Generate a summary, flashcards, a quiz, and more from what's already in this notebook."
            : "Add and index at least one source first, then generate study tools here."}
        </p>
      </div>
      <Button size="sm" onClick={onGenerate} disabled={!hasReadySources}>
        <Plus className="h-3.5 w-3.5" />
        Generate
      </Button>
    </div>
  );
}

function TypePicker({
  hasReadySources,
  starting,
  onPick,
  onCancel,
}: {
  hasReadySources: boolean;
  starting: ArtifactType | null;
  onPick: (t: ArtifactType) => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="mb-2 text-xs text-muted-foreground">Choose what to generate from this notebook&apos;s ready sources.</p>
      {(Object.keys(TYPE_META) as ArtifactType[]).map((type) => {
        const meta = TYPE_META[type];
        const Icon = meta.icon;
        const isStarting = starting === type;
        return (
          <button
            key={type}
            onClick={() => onPick(type)}
            disabled={!hasReadySources || starting !== null}
            className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-secondary/40 disabled:opacity-50"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Icon className="h-4 w-4 text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{meta.label}</div>
              <div className="text-[11px] text-muted-foreground">{meta.blurb}</div>
            </div>
          </button>
        );
      })}
      <Button size="sm" variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ArtifactRow({ artifact, onOpen, onDelete }: { artifact: ArtifactDTO; onOpen: () => void; onDelete: () => void }) {
  const meta = TYPE_META[artifact.type];
  const Icon = meta.icon;
  const inFlight = artifact.status === "QUEUED" || artifact.status === "GENERATING";

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border p-2.5">
      <button onClick={onOpen} disabled={inFlight} className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
          {inFlight ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Icon className="h-4 w-4 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{artifact.title}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{STATUS_LABEL[artifact.status]}</span>
            {inFlight && artifact.progress?.percent != null && <Progress value={artifact.progress.percent} className="h-1 w-16" />}
            {artifact.status === "FAILED" && artifact.errorMessage && (
              <span className="truncate text-destructive">— {artifact.errorMessage}</span>
            )}
          </div>
        </div>
        {!inFlight && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ArtifactViewer({ artifact, notebookId }: { artifact: ArtifactDTO; notebookId: string }) {
  const meta = TYPE_META[artifact.type];

  if (artifact.status === "FAILED") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        <div className="mb-1 font-medium">Generation failed</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
          {artifact.errorMessage ?? "Unknown error"}
        </pre>
      </div>
    );
  }

  if (artifact.status !== "READY" || !artifact.content) {
    return <div className="text-xs text-muted-foreground">This artifact isn&apos;t ready yet.</div>;
  }

  const NoContent = () => (
    <div className="text-xs text-muted-foreground">This artifact has no content, please regenerate.</div>
  );

  switch (artifact.type) {
    case "SUMMARY": {
      const content = artifact.content as { markdown?: string } | null;
      if (!content?.markdown) return <NoContent />;
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.markdown}</ReactMarkdown>
        </div>
      );
    }
    case "TAKEAWAYS": {
      const content = artifact.content as { items?: string[] } | null;
      const items = content?.items ?? [];
      if (!items.length) return <NoContent />;
      return (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 rounded-lg border border-border bg-secondary/20 p-2.5 text-sm">
              <span className="mt-0.5 shrink-0 text-primary">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "FLASHCARDS": {
      const content = artifact.content as { cards?: { front: string; back: string }[] } | null;
      const cards = content?.cards ?? [];
      if (!cards.length) return <NoContent />;
      return (
        <div className="space-y-4">
          <FlashcardDeck cards={cards} />
          <Link href="/dashboard/review">
            <Button size="sm" variant="outline" className="w-full">
              Review these with spaced repetition
            </Button>
          </Link>
        </div>
      );
    }
    case "QUIZ": {
      const content = artifact.content as {
        questions?: { question: string; options: string[]; correctIndex: number; explanation: string }[];
      } | null;
      const questions = content?.questions ?? [];
      if (!questions.length) return <NoContent />;
      return (
        <div className="space-y-4">
          <QuizDeck questions={questions} />
          <Link href="/dashboard/review">
            <Button size="sm" variant="outline" className="w-full">
              Review these with spaced repetition
            </Button>
          </Link>
        </div>
      );
    }
    case "MINDMAP": {
      const content = artifact.content as {
        nodes?: { id: string; label: string }[];
        edges?: { id: string; source: string; target: string }[];
      } | null;
      const nodes = content?.nodes ?? [];
      const edges = content?.edges ?? [];
      if (!nodes.length) return <NoContent />;
      return (
          <div className="h-[calc(90vh-9rem)] min-h-[420px] w-full">
            <MindMapViewer nodes={nodes} edges={edges} />
        </div>
      );
    }
    case "REPORT": {
      const content = artifact.content as { markdown?: string; sections?: { title: string; content: string }[] } | null;
      if (!content?.markdown) return <NoContent />;
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.markdown}</ReactMarkdown>
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * Paged flashcard study widget with a real 3D flip, keyboard/swipe-free
 * prev/next nav, a shuffle toggle, and a "known" tally — replaces the old
 * flat stack of static flip-in-place cards, which had no sense of
 * progress through the deck.
 */
function FlashcardDeck({ cards }: { cards: { front: string; back: string }[] }) {
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());

  if (cards.length === 0) return null;

  const cardIdx = order[index];
  const card = cards[cardIdx];

  function goTo(next: number) {
    setIndex(((next % cards.length) + cards.length) % cards.length);
    setFlipped(false);
  }

  function shuffle() {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setIndex(0);
    setFlipped(false);
  }

  function markKnown() {
    setKnown((prev) => new Set(prev).add(cardIdx));
    if (index < cards.length - 1) goTo(index + 1);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-primary">
            <Check className="h-3 w-3" /> {known.size} known
          </span>
          <button onClick={shuffle} className="flex items-center gap-1 hover:text-foreground" title="Shuffle deck">
            <Shuffle className="h-3 w-3" /> Shuffle
          </button>
        </div>
      </div>

      <Progress value={((index + 1) / cards.length) * 100} className="h-1" />

      <div style={{ perspective: 1200 }} className="w-full">
        <motion.button
          key={cardIdx}
          onClick={() => setFlipped((v) => !v)}
          className="relative block min-h-[140px] w-full text-left"
          style={{ transformStyle: "preserve-3d" }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.45, ease: [0.4, 0.2, 0.2, 1] }}
        >
          <div
            style={{ backfaceVisibility: "hidden" }}
            className="absolute inset-0 flex flex-col justify-center rounded-xl border border-border bg-secondary/20 p-4"
          >
            <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <RotateCw className="h-2.5 w-2.5" /> Front · tap to flip
            </div>
            <div className="text-sm font-medium leading-snug">{card.front}</div>
          </div>
          <div
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            className="absolute inset-0 flex flex-col justify-center rounded-xl border border-primary/40 bg-primary/5 p-4"
          >
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Back</div>
            <div className="text-sm leading-snug">{card.back}</div>
          </div>
          {/* Sizing spacer so the absolutely-positioned faces above get a real height */}
          <div className="invisible p-4 text-sm">{card.front}</div>
        </motion.button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => goTo(index - 1)} disabled={cards.length < 2}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={known.has(cardIdx) ? "outline" : "default"}
          className="flex-1"
          onClick={markKnown}
        >
          <Check className="h-3.5 w-3.5" /> {known.has(cardIdx) ? "Marked known" : "Mark known"}
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => goTo(index + 1)} disabled={cards.length < 2}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Interactive multiple-choice quiz preview. Options are real, clickable
 * buttons (the old version only rendered static `<div>`s behind a "Show
 * answer" toggle, so nothing was ever actually selectable) — picking one
 * locks the question, colors the correct/incorrect option, and reveals the
 * explanation, with a running score across the deck.
 */
function QuizDeck({
  questions,
}: {
  questions: { question: string; options: string[]; correctIndex: number; explanation: string }[];
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.entries(answers).filter(([qi, sel]) => sel === questions[Number(qi)].correctIndex).length;

  return (
    <div className="space-y-3">
      {questions.length > 1 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {answeredCount} of {questions.length} answered
          </span>
          {answeredCount > 0 && (
            <span className="font-medium text-primary">
              Score: {correctCount}/{answeredCount}
            </span>
          )}
        </div>
      )}
      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuizQuestion
            key={i}
            index={i}
            question={q}
            selected={answers[i] ?? null}
            onSelect={(optIndex) => setAnswers((prev) => ({ ...prev, [i]: optIndex }))}
          />
        ))}
      </div>
    </div>
  );
}

function QuizQuestion({
  index,
  question,
  selected,
  onSelect,
}: {
  index: number;
  question: { question: string; options: string[]; correctIndex: number; explanation: string };
  selected: number | null;
  onSelect: (optIndex: number) => void;
}) {
  const answered = selected !== null;
  const isCorrect = answered && selected === question.correctIndex;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-sm font-medium">
        {index + 1}. {question.question}
      </div>
      <div className="mt-2 space-y-1.5">
        {question.options.map((opt, i) => {
          const isCorrectOption = i === question.correctIndex;
          const isSelected = selected === i;
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => onSelect(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-default",
                !answered && "border-border hover:border-primary/50 hover:bg-primary/5",
                answered && isCorrectOption && "border-primary/50 bg-primary/10",
                answered && isSelected && !isCorrectOption && "border-destructive/50 bg-destructive/10"
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  answered && isCorrectOption
                    ? "border-primary bg-primary text-primary-foreground"
                    : answered && isSelected
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : "border-border"
                )}
              >
                {answered && isCorrectOption ? "✓" : answered && isSelected ? "✕" : String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-2 space-y-1">
          <p className={cn("text-[11px] font-medium", isCorrect ? "text-primary" : "text-destructive")}>
            {isCorrect ? "Correct!" : "Not quite"}
          </p>
          {question.explanation && <p className="text-[11px] text-muted-foreground">{question.explanation}</p>}
        </div>
      )}
    </div>
  );
}