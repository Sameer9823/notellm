"use client";

import type { VoiceCapabilities, VoiceError, VoiceErrorKind } from "./types";

export function detectCapabilities(): VoiceCapabilities {
  if (typeof window === "undefined") {
    return { supported: false, getUserMedia: false, webRTC: false, audioContext: false, missing: ["server rendering"] };
  }
  const missing: string[] = [];
  const getUserMedia = !!navigator.mediaDevices?.getUserMedia;
  const webRTC = typeof RTCPeerConnection !== "undefined";
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!getUserMedia) missing.push("microphone capture is unavailable");
  if (!webRTC) missing.push("WebRTC is unavailable");
  if (!AudioCtor) missing.push("Web Audio is unavailable");
  return { supported: missing.length === 0, getUserMedia, webRTC, audioContext: !!AudioCtor, missing };
}

const RULES: Array<[RegExp, VoiceErrorKind, string, boolean]> = [
  [/notallowed|permission denied|permission_denied/, "permission_denied", "Microphone access is required to start a voice conversation.", true],
  [/notfound|devicesnotfound|no microphone/, "microphone_unavailable", "No microphone was found on this device.", false],
  [/notreadable|track (start|ended)|audio_capture_failed/, "audio_capture_failed", "The microphone stopped responding. Check that it is still connected.", true],
  [/webrtc is not available|not support|unsupported/, "unsupported_browser", "This browser does not support the audio features this app needs. Try the latest Chrome, Edge, or Safari.", false],
  [/auth_failed|401|403|unauthor|api key/, "auth_failed", "The server could not authenticate with OpenAI. Check the OPENAI_API_KEY setting.", false],
  [/rate_limited|429|rate limit|too many requests/, "rate_limited", "OpenAI is rate limiting this account. Try again in a moment.", true],
  [/model_unavailable|\bmodel\b/, "model_unavailable", "The configured realtime model is not available for this API key.", false],
  [/connection_failed|network|failed to fetch|\bice\b|websocket/, "connection_failed", "Lost the connection to the voice service.", true],
  [/session/, "session_failed", "Could not start a realtime session. Please try again.", true],
];

export function toVoiceError(err: unknown): VoiceError {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";
  const haystack = `${name} ${raw}`.toLowerCase();

  for (const [pattern, kind, message, retryable] of RULES) {
    if (pattern.test(haystack)) return { kind, message, retryable };
  }
  return { kind: "unknown", message: "Something went wrong with the voice session. Please try again.", retryable: true };
}
