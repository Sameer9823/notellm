"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  RefreshCw,
  Sparkles,
  User,
  Volume2,
  Square,
  Pin,
  PinOff,
  ChevronDown,
} from "lucide-react";
import { CitationChip } from "@/components/chat/CitationChip";
import { cn } from "@/lib/utils";
import type { Citation, MessageDTO } from "@/types";

const THINKING_QUOTES = [
  "Thinking…",
  "Working on it…",
  "Piecing it together…",
  "Reading through the details…",
  "Almost there…",
  "Connecting the dots…",
];

function ThinkingIndicator() {
  const [quoteIndex, setQuoteIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_QUOTES.length),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % THINKING_QUOTES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 py-0.5 text-muted-foreground">
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-current"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
      <motion.span
        key={quoteIndex}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="text-[13px] italic"
      >
        "{THINKING_QUOTES[quoteIndex]}"
      </motion.span>
    </div>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1 text-primary">
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-current"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.1,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
      <span className="text-[13px] font-medium">Streaming…</span>
    </div>
  );
}

function CodeBlock({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const code = typeof children === "string" ? children : "";
  const language = className?.replace("language-", "") || "";

  return (
    <div className="relative group rounded-lg border border-border bg-muted/50 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/30">
        <span className="text-[11px] text-muted-foreground font-mono">
          {language || "code"}
        </span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {}
          }}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background hover:text-foreground"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px]">
        <code className={cn("language-" + language, className)}>{code}</code>
      </pre>
    </div>
  );
}

function Table({ children }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto my-4 rounded-lg border border-border">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

function Thead({ children }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-muted/50">{children}</thead>;
}

function Tbody({ children }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody>{children}</tbody>;
}

function Tr({ children }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="border-b border-border last:border-0">{children}</tr>;
}

function Th({
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className="px-3 py-2 text-[13px] border-t border-border/50">
      {children}
    </td>
  );
}

const markdownComponents = {
  code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const inline = !props.className;
    if (inline) {
      return (
        <code className="relative rounded bg-muted/50 px-1.5 py-0.5 text-[13px] font-mono text-primary">
          {children}
        </code>
      );
    }
    return <CodeBlock {...props}>{children}</CodeBlock>;
  },
  table: Table,
  thead: Thead,
  tbody: Tbody,
  tr: Tr,
  th: Th,
  td: Td,
  pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => children,
};

export function MessageBubble({
  message,
  onOpenCitation,
  onRegenerate,
  onPin,
  isLast,
  knownSourceIds,
}: {
  message: MessageDTO & { streaming?: boolean };
  onOpenCitation: (c: Citation) => void;
  onRegenerate?: () => void;
  onPin?: (message: MessageDTO) => void;
  isLast?: boolean;
  /** Set of source ids that currently exist in the notebook; citations whose
   *  sourceId is outside this set are rendered as "Source removed". */
  knownSourceIds?: Set<string>;
}) {
  const isUser = message.role === "USER";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showCitations, setShowCitations] = useState(true);

  useEffect(() => {
    return () => {
      if (speaking && typeof window !== "undefined")
        window.speechSynthesis.cancel();
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function handleSpeak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  async function handlePin() {
    if (!onPin || pinned) return;
    onPin(message);
    setPinned(true);
  }

  const contentLength = message.content?.length ?? 0;

  const showActions =
    !isUser && !message.streaming && contentLength > 0;
  const isThinking =
    !isUser && message.streaming && contentLength === 0;
  const isStreaming =
    !isUser && message.streaming && contentLength > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2.5 sm:gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-secondary text-foreground"
            : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </div>

      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1.5 sm:max-w-[75%]",
          isUser && "items-end",
        )}
      >
        <div
          className={cn(
            "px-4 py-3 text-[14px] leading-6",
            isUser
              ? "bg-secondary text-foreground rounded-xl"
              : "text-foreground w-full",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : isThinking ? (
            <ThinkingIndicator />
          ) : isStreaming ? (
            <>
              <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:font-display prose-headings:leading-tight prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-foreground prose-li:my-0.5 [&_h1]:text-[18px] [&_h2]:text-[16px] [&_h3]:text-[15px] prose-ul:pl-5 prose-ol:pl-5">
                <ReactMarkdown
                  components={markdownComponents}
                  remarkPlugins={[remarkGfm]}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
              <StreamingIndicator />
            </>
          ) : (
            <div className="prose prose-sm max-w-none break-words prose-p:my-2 prose-headings:font-display prose-headings:leading-tight prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-foreground prose-li:my-0.5 [&_h1]:text-[18px] [&_h2]:text-[16px] [&_h3]:text-[15px] prose-ul:pl-5 prose-ol:pl-5">
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setShowCitations(!showCitations)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showCitations && "rotate-180",
                )}
              />
              <span>Sources ({message.citations.length})</span>
            </button>
          </div>
        )}

        {showCitations &&
          !isUser &&
          message.citations &&
          message.citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((c) => {
              const isRemoved =
                !!c.sourceId &&
                !c.sourceId.startsWith("web:") &&
                knownSourceIds &&
                !knownSourceIds.has(c.sourceId);
              return (
                <CitationChip
                  key={`${c.chunkId}-${c.marker}`}
                  citation={c}
                  onOpen={onOpenCitation}
                  sourceRemoved={isRemoved}
                />
              );
            })}
            </div>
          )}

        {showActions && (
          <div className="flex items-center gap-1 text-muted-foreground pt-1 border-t border-border/50">
            <button
              onClick={handleCopy}
              title="Copy response"
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {copied ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={handleSpeak}
              title={speaking ? "Stop reading" : "Read aloud"}
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {speaking ? (
                <Square className="h-4 w-4 text-primary" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            {onPin && (
              <button
                onClick={handlePin}
                disabled={pinned}
                title={pinned ? "Pinned to notes" : "Pin to notes"}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground disabled:hover:bg-transparent"
              >
                {pinned ? (
                  <PinOff className="h-4 w-4 text-primary" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </button>
            )}

            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                title="Regenerate response"
                className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
