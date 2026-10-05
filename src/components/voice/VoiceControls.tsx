"use client";

import type { VoiceState } from "@/lib/voice/types";

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
  const label = connecting ? "Connecting…" : active ? "End conversation" : "Start conversation";

  return (
    <div className="primary">
      <button
        type="button"
        onClick={active ? onEnd : onStart}
        disabled={disabled || connecting || (busy && !active)}
      >
        {active ? "End" : "Start"} conversation
      </button>
      {disabled && disabledReason && <p className="status-hint">{disabledReason}</p>}
    </div>
  );
}
