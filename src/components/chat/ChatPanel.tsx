"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Send,
  Sparkles,
  Globe,
  Phone,
  ArrowDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceAgentScreen } from "@/components/voice/VoiceAgent";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import {
  chatToMarkdown,
  chatToPdfHtml,
  downloadMarkdown,
  printAsPdf,
} from "@/lib/export";
import { toast } from "sonner";
import type { Citation, MessageDTO, SourceDTO } from "@/types";

const CITATIONS_MARKER = "\n\u0000CITATIONS\u0000";

export type ChatPanelHandle = {
  focusInput: () => void;
  scrollToBottom: () => void;
};

export const ChatPanel = forwardRef<
  ChatPanelHandle,
  {
    notebookId: string;
    notebookTitle?: string;
    initialMessages: MessageDTO[];
    sources: SourceDTO[];
    scopeSourceId?: string | null;
    scopeSourceTitle?: string | null;
    onOpenCitation: (c: Citation) => void;
    onPin?: (message: MessageDTO) => void;
    focusMode?: boolean;
    /** Called with the raw response Headers whenever a query response comes
     *  back, so the credits badge can update from the X-Credits-* headers
     *  without a separate /api/credits round trip. */
    onCreditsHeaders?: (headers: Headers) => void;
  }
>(function ChatPanel(
  {
    notebookId,
    notebookTitle = "Notebook",
    initialMessages,
    sources,
    scopeSourceId = null,
    scopeSourceTitle = null,
    onOpenCitation,
    onPin,
    focusMode = false,
    onCreditsHeaders,
  },
  ref,
) {
  const [messages, setMessages] =
    useState<(MessageDTO & { streaming?: boolean })[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(52);

  useEffect(() => {
    if (!voiceOpen) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Citation;
      onOpenCitation({
        marker: detail.marker ?? 0,
        chunkId: detail.chunkId,
        sourceId: detail.sourceId,
        sourceTitle: detail.sourceTitle ?? "",
        sourceType: (detail.sourceType as Citation["sourceType"]) ?? "TEXT",
        page: detail.page ?? null,
        startSec: detail.startSec ?? null,
        endSec: detail.endSec ?? null,
        snippet: detail.snippet ?? "",
        url: detail.url ?? undefined,
      });
    };
    window.addEventListener("voice:open-citation", handler as EventListener);
    return () =>
      window.removeEventListener(
        "voice:open-citation",
        handler as EventListener,
      );
  }, [voiceOpen, onOpenCitation]);

  const [webSearchOn, setWebSearchOn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scopeRef = useRef(scopeSourceId);
  scopeRef.current = scopeSourceId;
  const webSearchRef = useRef(webSearchOn);
  webSearchRef.current = webSearchOn;

  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus(),
    scrollToBottom: () =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
  }));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const readySources = sources.filter((s) => s.status === "READY");

  const runQuery = useCallback(
    async (
      question: string,
      assistantId: string,
      sourceId: string | null,
      webSearch: boolean,
    ) => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, sourceId, webSearch }),
        });

        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          toast.error(
            retryAfter
              ? `Too many messages — try again in ${retryAfter}s.`
              : "Too many messages — slow down a bit.",
          );
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          toast.error(
            data.error ||
              "You're out of credits — they refresh every few hours.",
          );
          if (data.credits) {
            onCreditsHeaders?.(
              new Headers({
                "X-Credits-Balance": String(data.credits.balance),
                "X-Credits-Max": String(data.credits.max),
                "X-Credits-Reset": String(data.credits.resetAt),
              }),
            );
          }
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        onCreditsHeaders?.(res.headers);

        if (!res.body) throw new Error("No response stream");

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: data.answer,
                    citations: data.citations ?? [],
                    streaming: false,
                  }
                : m,
            ),
          );
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });

          const markerIdx = full.indexOf(CITATIONS_MARKER);
          const visible = markerIdx === -1 ? full : full.slice(0, markerIdx);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: visible, streaming: true }
                : m,
            ),
          );
        }

        const markerIdx = full.indexOf(CITATIONS_MARKER);
        const finalText = markerIdx === -1 ? full : full.slice(0, markerIdx);
        let citations: Citation[] = [];
        if (markerIdx !== -1) {
          try {
            citations = JSON.parse(
              full.slice(markerIdx + CITATIONS_MARKER.length),
            );
          } catch {
            citations = [];
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: finalText, citations, streaming: false }
              : m,
          ),
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: "Something went wrong answering that — try again.",
                  streaming: false,
                }
              : m,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [notebookId, onCreditsHeaders],
  );

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: MessageDTO = {
      id: `local-${Date.now()}`,
      role: "USER",
      content: question,
      createdAt: new Date().toISOString(),
    };
    const assistantId = `local-${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "ASSISTANT",
        content: "",
        citations: [],
        createdAt: new Date().toISOString(),
        streaming: true,
      },
    ]);

    runQuery(question, assistantId, scopeRef.current, webSearchRef.current);
  }

  function regenerateLast() {
    if (busy) return;
    const lastAssistantIdx = [...messages]
      .reverse()
      .findIndex((m) => m.role === "ASSISTANT");
    if (lastAssistantIdx === -1) return;
    const assistantIndex = messages.length - 1 - lastAssistantIdx;
    const assistantMsg = messages[assistantIndex];
    const precedingUser = [...messages.slice(0, assistantIndex)]
      .reverse()
      .find((m) => m.role === "USER");
    if (!precedingUser) return;

    setBusy(true);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMsg.id
          ? { ...m, content: "", citations: [], streaming: true }
          : m,
      ),
    );
    runQuery(
      precedingUser.content,
      assistantMsg.id,
      scopeRef.current,
      webSearchRef.current,
    );
  }

  const lastAssistantId = [...messages]
    .reverse()
    .find((m) => m.role === "ASSISTANT")?.id;

  const handleScroll = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
  }, []);

  // Auto-grow textarea
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      // Auto-grow: requestAnimationFrame to measure scrollHeight
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const ta = textareaRef.current;
          ta.style.height = "auto";
          const newHeight = Math.min(ta.scrollHeight, 200);
          setTextareaHeight(newHeight);
        }
      });
    },
    [],
  );

  return (
    <div className="flex h-full flex-col relative" data-testid="chat-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[13px] font-medium text-muted-foreground">
          Chat
        </span>
        <div className="flex items-center gap-1.5">
          <ExportMenu
            label="Export chat"
            disabled={messages.length === 0}
            onMarkdown={() =>
              downloadMarkdown(
                `${notebookTitle} - chat`,
                chatToMarkdown(notebookTitle, messages),
              )
            }
            onPdf={() =>
              printAsPdf(
                `${notebookTitle} — Chat`,
                chatToPdfHtml(notebookTitle, messages),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              focusMode &&
                "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
            )}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("notebook:focus-mode", { detail: !focusMode }),
              )
            }
            title={focusMode ? "Exit Focus Mode (Esc)" : "Focus Mode (⌘⇧F)"}
          >
            {focusMode ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {scopeSourceId && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          <span>
            Asking only{" "}
            <span className="font-medium text-foreground">
              {scopeSourceTitle ?? "this source"}
            </span>
          </span>
        </div>
      )}
      {webSearchOn && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-accent/5 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          <Globe className="h-3 w-3 text-accent" />
          <span>Web search is on — answers may cite live results</span>
        </div>
      )}
      <ScrollArea
        className="flex-1"
        ref={scrollAreaRef}
        onScroll={handleScroll}
      >
        <div
          className={cn(
            "mx-auto flex max-w-3xl flex-col gap-4 px-3 py-6 sm:px-5",
            focusMode && "max-w-4xl",
          )}
        >
          {messages.length === 0 ? (
            <EmptyState
              hasSources={readySources.length > 0}
              scopeTitle={scopeSourceId ? scopeSourceTitle : null}
              onAsk={ask}
            />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenCitation={onOpenCitation}
                isLast={m.id === lastAssistantId}
                onRegenerate={
                  m.id === lastAssistantId ? regenerateLast : undefined
                }
                onPin={onPin}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() =>
              bottomRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="absolute bottom-16 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg hover:bg-primary transition-all"
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      <div className="border-t border-border bg-card/60 p-3 sm:p-4">
        {voiceOpen ? (
          <VoiceAgentScreen
            notebookId={notebookId}
            onClose={() => setVoiceOpen(false)}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="mx-auto flex max-w-3xl items-end gap-1.5 sm:gap-2"
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setVoiceOpen(true)}
              title="Start voice conversation"
              className="shrink-0"
            >
              <Phone className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0 relative">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
                placeholder="Ask about your sources…"
                rows={1}
                className="resize-none bg-background border-border text-[14px] focus:border-ring transition-all"
                style={{ height: textareaHeight, minHeight: 52 }}
              />
              {/* Subtle custom scrollbar only when at max height */}
              <style jsx>{`
                textarea::-webkit-scrollbar {
                  width: 4px;
                }
                textarea::-webkit-scrollbar-track {
                  background: transparent;
                }
                textarea::-webkit-scrollbar-thumb {
                  background: hsl(var(--border));
                  border-radius: 2px;
                }
                textarea::-webkit-scrollbar-thumb:hover {
                  background: hsl(var(--ring));
                }
              `}</style>
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={busy || !input.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
        <p className="mx-auto mt-2 max-w-4xl text-center text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
          {scopeSourceId
            ? `Answers grounded in "${scopeSourceTitle ?? "this source"}"${webSearchOn ? " + web" : ""}`
            : readySources.length > 0
              ? `Answers grounded in your sources${webSearchOn ? " + web" : ""}`
              : webSearchOn
                ? "Web search on — live results"
                : "No sources — chat only. Add sources for grounded answers."}
        </p>
      </div>
    </div>
  );
});

function EmptyState({
  hasSources,
  scopeTitle,
  onAsk,
}: {
  hasSources: boolean;
  scopeTitle?: string | null;
  onAsk: (q: string) => void;
}) {
  const suggestions = scopeTitle
    ? [
        "Summarize this source",
        "What are the key takeaways here?",
        "What's the most surprising point?",
      ]
    : hasSources
      ? [
          "Summarize the key points across all sources",
          "What are the main takeaways?",
          "List anything that seems contradictory",
        ]
      : [
          "What can you help me with?",
          "Explain a concept to me",
          "Help me brainstorm something",
        ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center gap-4 py-12 text-center sm:py-16"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h3 className="font-display text-[15px] font-semibold">
          {scopeTitle
            ? `Ask about "${scopeTitle}"`
            : hasSources
              ? "Ask this notebook anything"
              : "Ask me anything"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
          {scopeTitle
            ? 'This chat is scoped to just this source. Switch to "All sources" in the rail to ask across everything.'
            : hasSources
              ? "Every answer is grounded in your sources and cited — you'll always know where it came from."
              : "No sources here yet, so this works like a regular chat — add a source anytime for grounded, cited answers, or turn on web search for live results."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 px-4">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onAsk(s)}
            className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
