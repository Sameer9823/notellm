"use client";

import type { VoiceError, VoiceState } from "@/lib/voice/types";

const STATUS_TEXT: Record<VoiceState, string> = {
  idle: "Ready when you are",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  listening: "Listening",
  user_speaking: "You're speaking",
  thinking: "Thinking…",
  speaking: "Speaking",
  assistant_speaking: "Speaking",
  interrupting: "Stopping…",
  interrupted: "Interrupted",
  error: "Something went wrong",
};

export interface VoiceStatusProps {
  state: VoiceState;
  error: VoiceError | null;
  toolRunning: boolean;
  active: boolean;
}

export function VoiceStatus({ state, error, toolRunning, active }: VoiceStatusProps) {
  if (error) {
    return (
      <div className="status" role="alert">
        <p>{error.message}</p>
        {error.retryable && <p>Start a new conversation to try again.</p>}
      </div>
    );
  }

  const base = active ? STATUS_TEXT[state] : STATUS_TEXT.idle;

  return (
    <div className="status" aria-live="polite">
      <p>
        {base}
        {toolRunning && <span> · using a tool</span>}
      </p>
      {state === "listening" && active && <p>Just start talking — you can interrupt at any time.</p>}
    </div>
  );
}
