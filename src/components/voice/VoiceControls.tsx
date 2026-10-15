"use client";

import { Mic, MicOff, Loader2, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceState } from "@/lib/voice/types";
import { Button } from "@/components/ui/button";

export interface VoiceControlsProps {
  active: boolean;
  state: VoiceState;
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  onStart(): void;
  onEnd(): void;
}

export function VoiceControls({ active, state, busy, disabled, disabledReason, onStart, onEnd }: VoiceControlsProps) {
  const connecting = state === "connecting" || state === "reconnecting";
  const isStarting = !active && (connecting || busy);
  const isStopping = active && (state === "interrupting" || busy);

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        size="lg"
        variant={active ? "destructive" : "default"}
        onClick={active ? onEnd : onStart}
        disabled={disabled || isStarting || isStopping}
        className="w-full max-w-xs gap-2"
        aria-label={active ? "End conversation" : "Start conversation"}
        aria-disabled={disabled || isStarting || isStopping}
      >
        {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isStopping && <X className="h-4 w-4" />}
        {!isStarting && !isStopping && !active && <Mic className="h-4 w-4" />}
        {!isStarting && !isStopping && active && <MicOff className="h-4 w-4" />}
        <span>{active ? "End conversation" : "Start conversation"}</span>
      </Button>

      {disabled && disabledReason && (
        <p className="text-center text-sm text-muted-foreground" role="status">
          <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
          {disabledReason}
        </p>
      )}

      {(state === "connecting" || state === "reconnecting") && (
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3 w-3 inline animate-spin mr-1" />
          Establishing secure connection…
        </p>
      )}
    </div>
  );
}