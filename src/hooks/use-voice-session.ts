"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  openaiRealtime,
  runVoiceAgent,
  stopMediaStream,
  type VoiceAgentEvent,
  type VoiceSession,
} from "samai-sdk/voice";
import { createVoiceAgent, turnDetection } from "@/lib/voice/agent";
import { VOICE_TOOLS } from "@/lib/voice/tools/client";
import { detectCapabilities, toVoiceError } from "@/lib/voice/helpers";
import { setToolToken } from "@/lib/voice/tool-token-store";
import { useSessionLimits } from "@/hooks/use-session-limits";
import type { VoiceCapabilities, VoiceError, VoiceErrorKind, VoiceState, SessionResponseBody, TurnOwner, TranscriptEntry } from "@/lib/voice/types";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 800;
const MICROPHONE_NOISE_FLOOR = 0.02;
const IDLE_TIMEOUT_MS = 60_000;
const IDLE_WARNING_MS = 45_000;

function maxDurationMs(): number | null {
  const raw = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_MAX_SESSION_MINUTES ?? null) : null;
  if (!raw) return 10 * 60_000;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
}

let entryCounter = 0;
function nextEntryId(): string {
  entryCounter += 1;
  return `entry-${entryCounter}`;
}

interface LevelMeter {
  read(): number;
  dispose(): void;
}

export interface UseVoiceSessionResult {
  state: VoiceState;
  turnOwner: TurnOwner;
  isActive: boolean;
  error: VoiceError | null;
  capabilities: VoiceCapabilities;
  transcript: TranscriptEntry[];
  micLevel(): number;
  assistantLevel(): number;
  toolRunning: boolean;
  muted: boolean;
  pushToTalk: boolean;
  talking: boolean;
  remainingMs: number | null;
  idleWarning: boolean;
  needsAudioUnlock: boolean;
  unlockAudio(): void;
  setMuted(muted: boolean): void;
  setPushToTalk(enabled: boolean): void;
  setTalking(talking: boolean): void;
  sendText(text: string): boolean;
  start(notebookId: string, language?: string): Promise<void>;
  stop(): Promise<void>;
}

export function useVoiceSession(): UseVoiceSessionResult {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<VoiceError | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [toolRunning, setToolRunning] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [pushToTalk, setPushToTalkState] = useState(false);
  const [talking, setTalkingState] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(true);

  const mutedRef = useRef(false);
  const talkingRef = useRef(false);
  const pushToTalkRef = useRef(false);
  const capabilitiesRef = useRef<VoiceCapabilities | null>(null);
  if (capabilitiesRef.current === null) capabilitiesRef.current = detectCapabilities();

  const sessionRef = useRef<VoiceSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micMeterRef = useRef<LevelMeter | null>(null);
  const assistantMeterRef = useRef<LevelMeter | null>(null);
  const meterContextRef = useRef<AudioContext | null>(null);
  const activeRef = useRef(false);
  const assistantSpeakingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const streamingRef = useRef<{ user?: string; assistant?: string }>({});
  const userTextRef = useRef("");
  const assistantTextRef = useRef("");
  const assistantCitationsRef = useRef<TranscriptEntry["citations"]>([]);
  const blockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastToolResultRef = useRef<Record<string, unknown> | null>(null);
  const currentLanguageRef = useRef("en");

  const applyMicGate = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const shouldCapture = !mutedRef.current && (!pushToTalkRef.current || talkingRef.current);
    if (track.enabled !== shouldCapture) track.enabled = shouldCapture;
  }, []);

  const setMuted = useCallback(
    (next: boolean) => {
      mutedRef.current = next;
      setMutedState(next);
      applyMicGate();
    },
    [applyMicGate]
  );

  const setPushToTalk = useCallback(
    (next: boolean) => {
      pushToTalkRef.current = next;
      setPushToTalkState(next);
      if (!next) {
        talkingRef.current = false;
        setTalkingState(false);
      }
      applyMicGate();
    },
    [applyMicGate]
  );

  const setTalking = useCallback(
    (next: boolean) => {
      if (!pushToTalkRef.current) return;
      talkingRef.current = next;
      setTalkingState(next);
      applyMicGate();
    },
    [applyMicGate]
  );

  const unlockAudio = useCallback(() => setNeedsAudioUnlock(false), []);

  const sendText = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const session = sessionRef.current;
    if (!session?.sendText) return false;
    try {
      session.sendText(trimmed);
      return true;
    } catch {
      return false;
    }
  }, []);

  const limits = useSessionLimits({
    maxDurationMs: maxDurationMs(),
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    idleWarningMs: IDLE_WARNING_MS,
    onMaxReached: () => {
      setError({ kind: "session_failed", message: "This conversation reached its time limit. Start a new one to keep going.", retryable: false });
      void stopRef.current();
    },
    onIdleEnd: () => {
      setError({ kind: "session_failed", message: "Ended after a period of silence.", retryable: false });
      void stopRef.current();
    },
  });

  const { begin: beginLimits, cancel: cancelLimits, markActivity, pause: pauseLimits, resume: resumeLimits } = limits;

  const finalizeAssistant = useCallback((interrupted: boolean) => {
    const id = streamingRef.current.assistant;
    streamingRef.current.assistant = undefined;
    if (!id) return;
    setTranscript((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? { ...entry, status: interrupted ? "interrupted" : "final", interrupted: interrupted || undefined, text: entry.text.trimEnd() }
          : entry
      )
    );
  }, []);

  const finalizeUser = useCallback(() => {
    const id = streamingRef.current.user;
    streamingRef.current.user = undefined;
    if (!id) return;
    setTranscript((prev) => prev.map((entry) => (entry.id === id ? { ...entry, status: "final", text: entry.text.trim() } : entry)));
  }, []);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    let context = meterContextRef.current;
    if (context && context.state !== "closed") {
      if (context.state === "suspended") void context.resume();
      return context;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    meterContextRef.current = context;
    if (context.state === "suspended") void context.resume();
    return context;
  }, []);

  const attachMeter = useCallback((context: AudioContext, stream: MediaStream, smoothing: number): LevelMeter => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = smoothing;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let level = 0;
    let frame: number | null = null;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const centred = (data[i] - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / data.length);
      const next = rms <= MICROPHONE_NOISE_FLOOR ? 0 : Math.min(1, (rms - MICROPHONE_NOISE_FLOOR) / (1 - MICROPHONE_NOISE_FLOOR));
      level = next > level ? next : level * 0.88 + next * 0.12;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return {
      read: () => level,
      dispose: () => {
        if (frame !== null) cancelAnimationFrame(frame);
        try { source.disconnect(); } catch {}
        try { analyser.disconnect(); } catch {}
      },
    };
  }, []);

  const handleEvent = useCallback(
    (event: VoiceAgentEvent) => {
      if (
        event.type === "user-speech-started" ||
        event.type === "user-speech-ended" ||
        event.type === "assistant-transcript-delta" ||
        event.type === "agent-speech-started"
      ) {
        markActivity();
      }

      switch (event.type) {
        case "connection-state":
          switch (event.state) {
            case "connected":
              reconnectAttemptRef.current = 0;
              setError(null);
              setState("listening");
              resumeLimits();
              break;
            case "connecting":
              setState("connecting");
              break;
            case "reconnecting":
              setState("reconnecting");
              pauseLimits();
              break;
            case "failed":
              if (activeRef.current) reconnectRef.current();
              else {
                setError({ kind: "connection_failed", message: "Lost the connection to the voice service.", retryable: true });
                setState("error");
              }
              break;
            case "closed":
              if (!activeRef.current) setState("idle");
              break;
          }
          break;

        case "user-speech-started":
          if (assistantSpeakingRef.current) {
            assistantSpeakingRef.current = false;
            finalizeAssistant(true);
          }
          setState("user_speaking");
          break;

        case "user-transcript-delta": {
          if (!event.delta) {
            const id = nextEntryId();
            streamingRef.current.user = id;
            userTextRef.current = "";
            setTranscript((prev) => [...prev, { id, role: "user", text: "", status: "streaming", startedAt: Date.now() }]);
            break;
          }
          const id = (streamingRef.current.user ??= nextEntryId());
          userTextRef.current += event.delta;
          setTranscript((prev) =>
            prev.some((entry) => entry.id === id)
              ? prev.map((entry) => (entry.id === id ? { ...entry, text: entry.text + event.delta } : entry))
              : [...prev, { id, role: "user", text: event.delta, status: "streaming", startedAt: Date.now() }]
          );
          break;
        }

        case "user-speech-ended":
          finalizeUser();
          setState("thinking");
          if (currentNotebookIdRef.current && sessionInfoRef.current?.sessionId && userTextRef.current.trim()) {
            fetch(`/api/notebooks/${currentNotebookIdRef.current}/voice/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                role: "USER",
                content: userTextRef.current.trim(),
                sessionId: sessionInfoRef.current.sessionId,
              }),
            }).catch(() => {});
          }
          userTextRef.current = "";
          break;

        case "assistant-transcript-delta": {
          const id = (streamingRef.current.assistant ??= nextEntryId());
          assistantTextRef.current += event.delta;
          setTranscript((prev) =>
            prev.some((entry) => entry.id === id)
              ? prev.map((entry) => (entry.id === id ? { ...entry, text: entry.text + event.delta } : entry))
              : [...prev, { id, role: "assistant", text: event.delta, status: "streaming", startedAt: Date.now() }]
          );
          break;
        }

        case "assistant-transcript-done":
          finalizeAssistant(false);
          if (currentNotebookIdRef.current && sessionInfoRef.current?.sessionId && assistantTextRef.current.trim()) {
            fetch(`/api/notebooks/${currentNotebookIdRef.current}/voice/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                role: "ASSISTANT",
                content: assistantTextRef.current.trim(),
                citations: assistantCitationsRef.current ?? null,
                sessionId: sessionInfoRef.current.sessionId,
              }),
            }).catch(() => {});
          }
          assistantTextRef.current = "";
          assistantCitationsRef.current = [];
          break;

        case "response-cancelled":
          assistantSpeakingRef.current = false;
          finalizeAssistant(true);
          break;

        case "agent-speech-started":
          assistantSpeakingRef.current = true;
          setState("assistant_speaking");
          break;

        case "agent-speech-ended":
          assistantSpeakingRef.current = false;
          setState((prev) => (prev === "assistant_speaking" || prev === "interrupting" ? "listening" : prev));
          break;

        case "agent-thinking":
          setState((prev) => (prev === "assistant_speaking" ? prev : "thinking"));
          break;

        case "interruption":
          setState("interrupting");
          break;

        case "tool-started":
          setToolRunning(true);
          break;

        case "tool-completed":
          setToolRunning(false);
          try {
            const result = JSON.parse((event as { result?: unknown }).result as string) as { results?: Array<{ chunkId?: string; sourceId?: string; sourceTitle?: string; sourceType?: string; page?: number; startSec?: number; endSec?: number; text?: string }> };
            if (result.results?.length) {
              const citations = result.results.map((r, idx) => ({
                marker: idx + 1,
                chunkId: r.chunkId ?? "",
                sourceId: r.sourceId ?? "",
                sourceTitle: r.sourceTitle ?? "",
                sourceType: r.sourceType ?? "",
                page: r.page,
                startSec: r.startSec,
                endSec: r.endSec,
                snippet: (r.text ?? "").slice(0, 220),
              }));
              const assistantId = streamingRef.current.assistant;
              if (assistantId) {
                assistantCitationsRef.current = citations;
                setTranscript((prev) =>
                  prev.map((entry) => (entry.id === assistantId ? { ...entry, citations } : entry))
                );
              }
            }
          } catch {
            // ignore malformed tool result
          }
          break;

        case "run-completed":
          setToolRunning(false);
          break;

        case "run-failed":
          setToolRunning(false);
          setError(toVoiceError(event.error));
          break;

        default:
          break;
      }
    },
    [finalizeAssistant, finalizeUser, markActivity, pauseLimits, resumeLimits]
  );

  const releaseAudio = useCallback(() => {
    micMeterRef.current?.dispose();
    micMeterRef.current = null;
    assistantMeterRef.current?.dispose();
    assistantMeterRef.current = null;
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.srcObject = null;
    }
    audioElRef.current = null;
    stopMediaStream(micStreamRef.current);
    micStreamRef.current = null;
    const context = meterContextRef.current;
    meterContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const releaseSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        await session.close();
      } catch {}
    }
  }, []);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearBlockTimer = useCallback(() => {
    if (blockTimerRef.current !== null) {
      clearInterval(blockTimerRef.current);
      blockTimerRef.current = null;
    }
  }, []);

  const renewBlock = useCallback(async () => {
    if (!activeRef.current || !currentNotebookIdRef.current) return;
    try {
      const res = await fetch(`/api/notebooks/${currentNotebookIdRef.current}/voice/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true, language: currentLanguageRef.current }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) {
          setError({ kind: "out_of_credits", message: data.error ?? "You're out of credits.", retryable: false });
          void stopRef.current();
        }
        return;
      }
      const sessionInfo = (await res.json()) as SessionResponseBody;
      sessionInfoRef.current = sessionInfo;
      setToolToken(sessionInfo.toolToken);
    } catch {
      // best-effort renewal; the next reconnect will try again
    }
  }, []);

  const connect = useCallback(
    async (notebookId: string, sessionInfo: SessionResponseBody) => {
      const caps = capabilitiesRef.current!;
      if (!caps.supported) {
        setError({ kind: "unsupported_browser", message: `This browser can't run a voice conversation: ${caps.missing.join(", ")}.`, retryable: false });
        setState("error");
        return;
      }

      setState("connecting");
      setError(null);

      let micStream: MediaStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (err) {
        setError(toVoiceError(err));
        setState("error");
        return;
      }
      micStreamRef.current = micStream;
      applyMicGate();

      const agent = createVoiceAgent(sessionInfo.model, sessionInfo.voice, sessionInfo.instructions);
      const context = ensureAudioContext();

      if (!audioElRef.current) {
        const el = new Audio();
        el.setAttribute("playsinline", "true");
        audioElRef.current = el;
      }
      const audioEl = audioElRef.current;

      try {
        const provider = openaiRealtime({
          transport: "webrtc",
          clientSecret: sessionInfo.clientSecret,
          model: sessionInfo.model,
          voice: sessionInfo.voice,
          inputStream: micStream,
          turnDetection,
          onRemoteStream: (remoteStream) => {
            audioEl.srcObject = remoteStream;
            audioEl.autoplay = true;
            void audioEl.play().catch(() => {});
            if (context) assistantMeterRef.current = attachMeter(context, remoteStream, 0.7);
          },
        });

        const { session } = await runVoiceAgent(provider, agent, {
          onEvent: handleEvent,
        });

        if (!activeRef.current) {
          await session.close();
          return;
        }
        sessionRef.current = session;

        if (context) micMeterRef.current = attachMeter(context, micStream, 0.6);
      } catch (err) {
        releaseAudio();
        await releaseSession();
        if (activeRef.current) {
          setError(toVoiceError(err));
          reconnectRef.current();
          return;
        }
        setError(toVoiceError(err));
        setState("error");
      }
    },
    [applyMicGate, attachMeter, ensureAudioContext, handleEvent, releaseAudio, releaseSession]
  );

  const scheduleReconnect = useCallback(() => {
    if (!activeRef.current) return;
    const attempt = reconnectAttemptRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setError({ kind: "connection_failed", message: `Lost the connection and could not reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`, retryable: true });
      setState("error");
      return;
    }

    reconnectAttemptRef.current = attempt + 1;
    setState("reconnecting");
    pauseLimits();

    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      if (!activeRef.current) return;
      await releaseSession();
      releaseAudio();
      const sessionInfo = await fetch(`/api/notebooks/${currentNotebookIdRef.current}/voice/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true, language: currentLanguageRef.current }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to re-mint session");
        return r.json();
      });
      await connect(currentNotebookIdRef.current, sessionInfo);
    }, RECONNECT_BASE_DELAY_MS * 2 ** attempt);
  }, [connect, pauseLimits, releaseAudio, releaseSession]);

  reconnectRef.current = scheduleReconnect;

  const currentNotebookIdRef = useRef<string>("");
  const sessionInfoRef = useRef<SessionResponseBody | null>(null);

  const start = useCallback(async (notebookId: string, language: string = "en") => {
    if (activeRef.current) return;
    cancelReconnect();
    activeRef.current = true;
    reconnectAttemptRef.current = 0;
    setIsActive(true);
    setTranscript([]);
    streamingRef.current = {};
    userTextRef.current = "";
    assistantTextRef.current = "";
    assistantCitationsRef.current = [];
    setToolRunning(false);
    talkingRef.current = false;
    setTalkingState(false);
    setState("connecting");
    beginLimits();

    currentNotebookIdRef.current = notebookId;
    currentLanguageRef.current = language;

    const res = await fetch(`/api/notebooks/${notebookId}/voice/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      let kind: VoiceErrorKind = "session_failed";
      if (res.status === 401) kind = "unauthorized";
      else if (res.status === 402) kind = "out_of_credits";
      else if (res.status === 404) kind = "forbidden";
      else if (res.status === 429) kind = "rate_limited";
      else if (res.status === 500 && data.error === "auth_failed") kind = "auth_failed";

      activeRef.current = false;
      setIsActive(false);
      setError({ kind, message: data.error ?? "Could not start a voice session.", retryable: res.status === 429 || res.status >= 500 });
      setState("error");
      return;
    }

    const sessionInfo = (await res.json()) as SessionResponseBody;
    sessionInfoRef.current = sessionInfo;
    setToolToken(sessionInfo.toolToken);
    await connect(notebookId, sessionInfo);

    if (activeRef.current) {
      clearBlockTimer();
      blockTimerRef.current = setInterval(() => {
        void renewBlock();
      }, (Number(process.env.NEXT_PUBLIC_VOICE_CREDIT_BLOCK_MINUTES ?? 5)) * 60 * 1000);
    }
  }, [beginLimits, cancelReconnect, clearBlockTimer, connect, renewBlock]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    assistantSpeakingRef.current = false;
    setIsActive(false);
    cancelReconnect();
    cancelLimits();
    clearBlockTimer();
    await releaseSession();
    releaseAudio();
    streamingRef.current = {};
    setToolRunning(false);
    setError(null);
    setState("idle");
  }, [cancelLimits, cancelReconnect, clearBlockTimer, releaseAudio, releaseSession]);

  stopRef.current = stop;

  useEffect(() => {
    return () => {
      activeRef.current = false;
      cancelReconnect();
      clearBlockTimer();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void session.close().catch(() => {});
      micMeterRef.current?.dispose();
      assistantMeterRef.current?.dispose();
      stopMediaStream(micStreamRef.current);
      micStreamRef.current = null;
      const el = audioElRef.current;
      if (el) {
        el.pause();
        el.srcObject = null;
      }
      audioElRef.current = null;
      const context = meterContextRef.current;
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
  }, [cancelReconnect, clearBlockTimer]);

  return {
    state,
    turnOwner: state === "user_speaking" ? "user" : state === "assistant_speaking" ? "assistant" : "none",
    isActive,
    error,
    capabilities: capabilitiesRef.current!,
    transcript,
    micLevel: () => micMeterRef.current?.read() ?? 0,
    assistantLevel: () => assistantMeterRef.current?.read() ?? 0,
    toolRunning,
    muted,
    pushToTalk,
    talking,
    remainingMs: limits.remainingMs,
    idleWarning: limits.idleWarning,
    needsAudioUnlock,
    unlockAudio,
    setMuted,
    setPushToTalk,
    setTalking,
    sendText,
    start,
    stop,
  };
}
