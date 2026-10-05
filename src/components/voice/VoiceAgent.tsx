"use client";

import { useState, useCallback } from "react";
import { VoiceOrb } from "./VoiceOrb";
import { VoiceStatus } from "./VoiceStatus";
import { VoiceControls } from "./VoiceControls";
import { VoiceTranscript } from "./VoiceTranscript";
import { useVoiceSession, type UseVoiceSessionResult } from "@/hooks/use-voice-session";

export function VoiceAgentScreen({ notebookId, onClose }: { notebookId: string; onClose: () => void }) {
  const session = useVoiceSession();
  const [starting, setStarting] = useState(false);
  const [language, setLanguage] = useState("en");

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await session.start(notebookId, language);
    } finally {
      setStarting(false);
    }
  }, [notebookId, session, language]);

  const handleOpenCitation = useCallback((c: { sourceId: string; chunkId: string; page?: number | null; startSec?: number | null; endSec?: number | null }) => {
    window.dispatchEvent(new CustomEvent("voice:open-citation", { detail: c }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Voice</span>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-4">
        <VoiceOrb
          state={session.state}
          micLevel={session.micLevel}
          assistantLevel={session.assistantLevel}
          active={session.isActive}
        />

        <VoiceStatus
          state={session.state}
          error={session.error}
          toolRunning={session.toolRunning}
          active={session.isActive}
        />

        <VoiceControls
          active={session.isActive}
          state={session.state}
          busy={starting || session.state === "connecting" || session.state === "reconnecting"}
          disabled={!session.capabilities.supported}
          disabledReason={
            !session.capabilities.supported
              ? `This browser isn't supported. Missing: ${session.capabilities.missing.join(", ")}`
              : session.error?.kind === "out_of_credits"
              ? "Out of credits"
              : undefined
          }
          onStart={handleStart}
          onEnd={session.stop}
        />

        {!session.isActive && (
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="ta">Tamil</option>
          </select>
        )}

        {session.isActive && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => session.setMuted(!session.muted)}
              className="rounded border border-border px-3 py-1.5 text-xs"
            >
              {session.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        )}
      </div>

      <VoiceTranscript
        entries={session.transcript}
        agentName="Assistant"
        actions={null}
        composer={null}
        onOpenCitation={handleOpenCitation}
      />
    </div>
  );
}
