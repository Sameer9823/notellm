"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Mic, MicOff, Send, Sparkles, Globe, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VoiceAgentScreen } from "@/components/voice/VoiceAgent";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { chatToMarkdown, chatToPdfHtml, downloadMarkdown, printAsPdf } from "@/lib/export";
import { toast } from "sonner";
import type { Citation, MessageDTO, SourceDTO } from "@/types";

const CITATIONS_MARKER = "\n\u0000CITATIONS\u0000";

export type ChatPanelHandle = {
  focusInput: () => void;
};

export const ChatPanel = forwardRef<ChatPanelHandle, {
  notebookId: string;
  notebookTitle?: string;
  initialMessages: MessageDTO[];
  sources: SourceDTO[];
  scopeSourceId?: string | null;
  scopeSourceTitle?: string | null;
  onOpenCitation: (c: Citation) => void;
  onPin?: (message: MessageDTO) => void;
  /** Called with the raw response Headers whenever a query response comes
   *  back, so the credits badge can update from the X-Credits-* headers
   *  without a separate /api/credits round trip. */
  onCreditsHeaders?: (headers: Headers) => void;
}>(function ChatPanel({ notebookId, notebookTitle = "Notebook", initialMessages, sources, scopeSourceId = null, scopeSourceTitle = null, onOpenCitation, onPin, onCreditsHeaders }, ref) {
  const [messages, setMessages] = useState<(MessageDTO & { streaming?: boolean })[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    if (!voiceOpen) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sourceId: string; chunkId: string; page?: number | null; startSec?: number | null; endSec?: number | null };
      onOpenCitation({
        marker: 0,
        chunkId: detail.chunkId,
        sourceId: detail.sourceId,
        sourceTitle: "",
        sourceType: "TEXT",
        page: detail.page ?? null,
        startSec: detail.startSec ?? null,
        endSec: detail.endSec ?? null,
        snippet: "",
      });
    };
    window.addEventListener("voice:open-citation", handler as EventListener);
    return () => window.removeEventListener("voice:open-citation", handler as EventListener);
  }, [voiceOpen, onOpenCitation]);
  // Persists across messages in this session (not saved server-side) —
  // mirrors ChatGPT's web-browsing toggle: once turned on, every question
  // asked in this chat pulls in live web results alongside notebook context,
  // until turned back off.
  const [webSearchOn, setWebSearchOn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Kept in a ref (not just a closure var) so an in-flight streamed answer
  // always reports the scope that was active when it was asked, even if
  // the user switches the active source again before it finishes.
  const scopeRef = useRef(scopeSourceId);
  scopeRef.current = scopeSourceId;
  const webSearchRef = useRef(webSearchOn);
  webSearchRef.current = webSearchOn;

  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus(),
  }));

  // const { isSupported: micSupported, isListening, toggle: toggleMic } = useSpeechRecognition(setInput);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const readySources = sources.filter((s) => s.status === "READY");

  const runQuery = useCallback(
    async (question: string, assistantId: string, sourceId: string | null, webSearch: boolean) => {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, sourceId, webSearch }),
        });

        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          toast.error(
            retryAfter ? `Too many messages — try again in ${retryAfter}s.` : "Too many messages — slow down a bit."
          );
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }

        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || "You're out of credits — they refresh every few hours.");
          if (data.credits) {
            onCreditsHeaders?.(
              new Headers({
                "X-Credits-Balance": String(data.credits.balance),
                "X-Credits-Max": String(data.credits.max),
                "X-Credits-Reset": String(data.credits.resetAt),
              })
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
            prev.map((m) => (m.id === assistantId ? { ...m, content: data.answer, citations: data.citations ?? [], streaming: false } : m))
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

          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: visible, streaming: true } : m)));
        }

        const markerIdx = full.indexOf(CITATIONS_MARKER);
        const finalText = markerIdx === -1 ? full : full.slice(0, markerIdx);
        let citations: Citation[] = [];
        if (markerIdx !== -1) {
          try {
            citations = JSON.parse(full.slice(markerIdx + CITATIONS_MARKER.length));
          } catch {
            citations = [];
          }
        }

        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: finalText, citations, streaming: false } : m)));
      } catch {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: "Something went wrong answering that — try again.", streaming: false } : m))
        );
      } finally {
        setBusy(false);
      }
    },
    [notebookId, onCreditsHeaders]
  );

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: MessageDTO = { id: `local-${Date.now()}`, role: "USER", content: question, createdAt: new Date().toISOString() };
    const assistantId = `local-${Date.now() + 1}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "ASSISTANT", content: "", citations: [], createdAt: new Date().toISOString(), streaming: true },
    ]);

    runQuery(question, assistantId, scopeRef.current, webSearchRef.current);
  }

  function regenerateLast() {
    if (busy) return;
    const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === "ASSISTANT");
    if (lastAssistantIdx === -1) return;
    const assistantIndex = messages.length - 1 - lastAssistantIdx;
    const assistantMsg = messages[assistantIndex];
    const precedingUser = [...messages.slice(0, assistantIndex)].reverse().find((m) => m.role === "USER");
    if (!precedingUser) return;

    setBusy(true);
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: "", citations: [], streaming: true } : m))
    );
    runQuery(precedingUser.content, assistantMsg.id, scopeRef.current, webSearchRef.current);
  }

  // Removed browser SpeechRecognition mic in favor of realtime voice mode.

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "ASSISTANT")?.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Chat</span>
        <ExportMenu
          label="Export chat"
          disabled={messages.length === 0}
          onMarkdown={() => downloadMarkdown(`${notebookTitle} - chat`, chatToMarkdown(notebookTitle, messages))}
          onPdf={() => printAsPdf(`${notebookTitle} — Chat`, chatToPdfHtml(notebookTitle, messages))}
        />
      </div>
      {scopeSourceId && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          <span>
            Asking only <span className="font-medium text-foreground">{scopeSourceTitle ?? "this source"}</span>
          </span>
        </div>
      )}
      {webSearchOn && (
        <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-border bg-accent/5 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          <Globe className="h-3 w-3 text-accent" />
          <span>Web search is on — answers may cite live results</span>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-3 py-6 sm:px-5">
          {messages.length === 0 ? (
            <EmptyState hasSources={readySources.length > 0} scopeTitle={scopeSourceId ? scopeSourceTitle : null} onAsk={ask} />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenCitation={onOpenCitation}
                isLast={m.id === lastAssistantId}
                onRegenerate={m.id === lastAssistantId ? regenerateLast : undefined}
                onPin={onPin}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-card/60 p-3 sm:p-4">
        {voiceOpen ? (
          <VoiceAgentScreen notebookId={notebookId} onClose={() => setVoiceOpen(false)} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="mx-auto flex max-w-2xl items-end gap-1.5 sm:gap-2"
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
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder={
                scopeSourceId
                  ? `Ask a question about ${scopeSourceTitle ?? "this source"}…`
                  : readySources.length > 0
                  ? "Ask a question grounded in your sources…"
                  : webSearchOn
                  ? "Ask anything — I'll search the web…"
                  : "Ask anything, like you would ChatGPT…"
              }
              rows={1}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
        <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-muted-foreground">
          {scopeSourceId
            ? `Answers are grounded in "${scopeSourceTitle ?? "this source"}", with every claim cited${webSearchOn ? ", plus live web results" : ""}.`
            : readySources.length > 0
            ? `Answers are grounded in this notebook's sources, with every claim cited${webSearchOn ? ", plus live web results" : ""}. Nothing relevant? I'll say so and answer generally.`
            : webSearchOn
            ? "Web search is on — I'll pull in live results and cite them."
            : "No sources yet, so I'll just chat — add a source anytime for grounded, cited answers, or turn on web search for live results."}
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
    ? ["Summarize this source", "What are the key takeaways here?", "What's the most surprising point?"]
    : hasSources
    ? ["Summarize the key points across all sources", "What are the main takeaways?", "List anything that seems contradictory"]
    : ["What can you help me with?", "Explain a concept to me", "Help me brainstorm something"];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 py-12 text-center sm:py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold">
          {scopeTitle ? `Ask about "${scopeTitle}"` : hasSources ? "Ask this notebook anything" : "Ask me anything"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {scopeTitle
            ? "This chat is scoped to just this source. Switch to \"All sources\" in the rail to ask across everything."
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
};