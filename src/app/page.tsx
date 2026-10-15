import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  FileText,
  Youtube,
  Globe,
  Captions,
  File,
  Quote,
  ShieldCheck,
  Layers,
  UploadCloud,
  MessageSquare,
  MousePointerClick,
  GraduationCap,
  Repeat,
  BrainCircuit,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-grid">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <Logo className="h-5 w-5 text-primary" />
          Footnote
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">Get started free</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          Every answer traces back to a source — click to verify it
        </span>
        <h1 className="mt-6 font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Stop copy-pasting into ChatGPT. <span className="text-primary">Ask your sources</span> directly.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
          Drop in PDFs, web pages, YouTube videos, or transcripts and Footnote reads them for you. Ask a
          question in plain language and get an answer footnoted to the exact page, timestamp, or
          passage it came from — never a guess dressed up as fact.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/sign-up">
            <Button size="lg">Create your first notebook</Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline">
              Sign in
            </Button>
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">No credit card required.</p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { icon: File, label: "PDF" },
            { icon: Globe, label: "Web link" },
            { icon: Youtube, label: "YouTube" },
            { icon: FileText, label: "Text" },
            { icon: Captions, label: "Transcript" },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/50 py-6 text-sm text-muted-foreground"
            >
              <s.icon className="h-5 w-5 text-primary" />
              {s.label}
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Feature
            icon={Layers}
            title="Isolated notebooks"
            desc="Every notebook keeps its own sources and its own vector index — nothing bleeds across projects."
          />
          <Feature
            icon={Quote}
            title="Inline citations"
            desc="Every claim in every answer links back to the exact chunk that produced it, with a live status trail from upload to indexed."
          />
          <Feature
            icon={ShieldCheck}
            title="No silent hallucination"
            desc="When your sources don't cover a question, Footnote says so instead of guessing."
          />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-center font-display text-2xl font-semibold sm:text-3xl">How it works</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
          Three steps from raw material to a cited answer.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <Step
            icon={UploadCloud}
            step="1"
            title="Add your sources"
            desc="Upload a PDF, paste a link, or drop in a YouTube video. Footnote extracts, chunks, and indexes it in the background."
          />
          <Step
            icon={MessageSquare}
            step="2"
            title="Ask a question"
            desc="Chat with your notebook like you would a colleague who actually read everything you gave them."
          />
          <Step
            icon={MousePointerClick}
            step="3"
            title="Click to verify"
            desc="Every sentence links to a citation chip. Click it and jump straight to the page, timestamp, or passage it came from."
          />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-center font-display text-2xl font-semibold sm:text-3xl">Beyond the answer</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
          Turn what you've read into things you'll actually remember.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={GraduationCap}
            title="Study tools"
            desc="Generate a summary, key takeaways, flashcards, a quiz, a mind map, or a full report from any notebook's sources in one click."
          />
          <Feature
            icon={Repeat}
            title="Spaced-repetition review"
            desc="Flashcards and quiz questions become a daily review queue, scheduled with the same SM-2 algorithm behind Anki, so what you learn actually sticks."
          />
          <Feature
            icon={BrainCircuit}
            title="Long-term memory"
            desc="Footnote remembers durable facts about you — goals, preferences, background — across every notebook's chat, editable anytime from Settings."
          />
          <Feature
            icon={CreditCard}
            title="Flexible billing"
            desc="Start free with a recurring credit window, then top up with a one-time pack or subscribe monthly for heavier use — no surprise limits."
          />
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-1.5">
          <Logo className="h-3.5 w-3.5" />
          Footnote — research grounded in what you actually gave it.
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: typeof Layers; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <Icon className="h-5 w-5 text-primary" />
      <h3 className="mt-3 font-display text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Step({
  icon: Icon,
  step,
  title,
  desc,
}: {
  icon: typeof UploadCloud;
  step: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-card/50 p-5">
      <span className="absolute -top-3 -left-1 font-display text-4xl font-bold text-primary/10">
        {step}
      </span>
      <Icon className="relative h-5 w-5 text-primary" />
      <h3 className="relative mt-3 font-display text-sm font-semibold">{title}</h3>
      <p className="relative mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}