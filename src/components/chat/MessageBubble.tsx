"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import { Check, Copy, RefreshCw, Sparkles, User, Volume2, Square, Pin, PinOff } from "lucide-react";
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
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * THINKING_QUOTES.length));

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
        className="text-sm italic"
      >
        "{THINKING_QUOTES[quoteIndex]}"
      </motion.span>
    </div>
  );
}

export function MessageBubble({
  message,
  onOpenCitation,
  onRegenerate,
  onPin,
  isLast,
}: {
  message: MessageDTO & { streaming?: boolean };
  onOpenCitation: (c: Citation) => void;
  onRegenerate?: () => void;
  onPin?: (message: MessageDTO) => void;
  isLast?: boolean;
}) {
  const isUser = message.role === "USER";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Stop any in-flight speech if this bubble unmounts or its text changes
  // out from under the currently-playing utterance.
  useEffect(() => {
    return () => {
      if (speaking && typeof window !== "undefined") window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permissions denied — nothing useful to do
    }
  }

  function handleSpeak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel(); // stop any other bubble currently reading
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

  const showActions = !isUser && !message.streaming && message.content.length > 0;
  const isThinking = !isUser && message.streaming && message.content.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2.5 sm:gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-secondary text-foreground" : "bg-primary/15 text-primary"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </div>

      <div className={cn("flex max-w-[88%] flex-col gap-1.5 sm:max-w-[80%]", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-secondary text-foreground" : "bg-card border border-border"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : isThinking ? (
            <ThinkingIndicator />
          ) : (
            <div className="prose prose-sm prose-invert max-w-none break-words prose-p:my-2 prose-ul:my-2 prose-headings:font-display">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <CitationChip key={`${c.chunkId}-${c.marker}`} citation={c} onOpen={onOpenCitation} />
            ))}
          </div>
        )}

        {showActions && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <button
              onClick={handleCopy}
              title="Copy response"
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={handleSpeak}
              title={speaking ? "Stop reading" : "Read aloud"}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              {speaking ? <Square className="h-3.5 w-3.5 text-primary" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>

            {onPin && (
              <button
                onClick={handlePin}
                disabled={pinned}
                title={pinned ? "Pinned to notes" : "Pin to notes"}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground disabled:hover:bg-transparent"
              >
                {pinned ? <PinOff className="h-3.5 w-3.5 text-primary" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
            )}

            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                title="Regenerate response"
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-secondary/70 hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}