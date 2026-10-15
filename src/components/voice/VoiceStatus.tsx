"use client";

import { cn } from "@/lib/utils";
import { Mic, Volume2, Loader2, AlertCircle, CheckCircle, Brain, Zap } from "lucide-react";
import type { VoiceError, VoiceState } from "@/lib/voice/types";

const STATUS_CONFIG: Record<VoiceState, { text: string; icon: typeof Mic; color: string; animate?: boolean }> = {
  idle: { text: "Ready when you are", icon: Mic, color: "text-muted-foreground" },
  connecting: { text: "Connecting…", icon: Loader2, color: "text-primary", animate: true },
  reconnecting: { text: "Reconnecting…", icon: Loader2, color: "text-primary", animate: true },
  listening: { text: "Listening", icon: Mic, color: "text-primary" },
  user_speaking: { text: "You're speaking", icon: Mic, color: "text-primary" },
  thinking: { text: "Thinking…", icon: Brain, color: "text-accent", animate: true },
  speaking: { text: "Speaking", icon: Volume2, color: "text-accent" },
  assistant_speaking: { text: "Speaking", icon: Volume2, color: "text-accent" },
  interrupting: { text: "Stopping…", icon: Zap, color: "text-amber-500", animate: true },
  interrupted: { text: "Interrupted", icon: AlertCircle, color: "text-destructive" },
  error: { text: "Something went wrong", icon: AlertCircle, color: "text-destructive" },
};

export interface VoiceStatusProps {
  state: VoiceState;
  error: VoiceError | null;
  toolRunning: boolean;
  active: boolean;
}

export function VoiceStatus({ state, error, toolRunning, active }: VoiceStatusProps) {
  const config = STATUS_CONFIG[state];

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20" role="alert">
        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-destructive">{error.message}</p>
          {error.retryable && <p className="text-sm text-muted-foreground">Start a new conversation to try again.</p>}
        </div>
      </div>
    );
  }

  const base = active ? config : STATUS_CONFIG.idle;
  const Icon = base.icon;

  return (
    <div className={cn("flex items-center gap-2 p-3 rounded-lg bg-card border border-border", active && "bg-primary/5")} aria-live="polite">
      <Icon className={cn("h-5 w-5 flex-shrink-0", base.color, base.animate && "animate-spin")} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{base.text}</p>
        {toolRunning && <p className="text-sm text-muted-foreground">Using a tool…</p>}
        {state === "listening" && active && <p className="text-sm text-muted-foreground">Just start talking — you can interrupt at any time.</p>}
        {state === "thinking" && <p className="text-sm text-muted-foreground">Processing your question…</p>}
      </div>
    </div>
  );
}