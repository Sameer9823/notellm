import type { ConversationState } from "samai-sdk/voice";

export type VoiceState = ConversationState;
export type TurnOwner = "none" | "user" | "assistant";
export type TranscriptEntryStatus = "streaming" | "final" | "interrupted";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: TranscriptEntryStatus;
  startedAt: number;
  interrupted?: boolean;
  citations?: Array<{
    marker: number;
    chunkId: string;
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
    page?: number;
    startSec?: number;
    endSec?: number;
    snippet: string;
  }>;
}

export type VoiceErrorKind =
  | "unsupported_browser"
  | "microphone_unavailable"
  | "permission_denied"
  | "audio_capture_failed"
  | "auth_failed"
  | "rate_limited"
  | "connection_failed"
  | "session_failed"
  | "session_active"
  | "model_unavailable"
  | "forbidden"
  | "unauthorized"
  | "invalid_voice"
  | "invalid_model"
  | "out_of_credits"
  | "unknown";

export interface VoiceError {
  kind: VoiceErrorKind;
  message: string;
  retryable: boolean;
}

export interface VoiceCapabilities {
  supported: boolean;
  getUserMedia: boolean;
  webRTC: boolean;
  audioContext: boolean;
  missing: string[];
}

export interface SessionResponseBody {
  clientSecret: string;
  expiresAt: number | null;
  model: string;
  voice: string;
  instructions: string;
  sessionId: string;
  toolToken: string;
}
