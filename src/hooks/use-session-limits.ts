"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionLimitsOptions {
  maxDurationMs: number | null;
  idleTimeoutMs: number;
  idleWarningMs: number;
  onMaxReached(): void;
  onIdleEnd(): void;
}

export interface SessionLimitsResult {
  remainingMs: number | null;
  idleMs: number;
  idleWarning: boolean;
  markActivity(): void;
  begin(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  reset(): void;
}

const TICK_MS = 500;

export function useSessionLimits(options: SessionLimitsOptions): SessionLimitsResult {
  const { maxDurationMs, idleTimeoutMs, idleWarningMs, onMaxReached, onIdleEnd } = options;

  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [idleMs, setIdleMs] = useState(0);
  const [idleWarning, setIdleWarning] = useState(false);

  const startedAtRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number | null>(null);
  const firedRef = useRef({ max: false, idle: false });
  const pausedRef = useRef(false);

  const onMaxRef = useRef(onMaxReached);
  const onIdleRef = useRef(onIdleEnd);
  onMaxRef.current = onMaxReached;
  onIdleRef.current = onIdleEnd;

  const begin = useCallback(() => {
    const now = Date.now();
    startedAtRef.current = now;
    lastActivityRef.current = now;
    firedRef.current = { max: false, idle: false };
    pausedRef.current = false;
    setRemainingMs(maxDurationMs);
    setIdleMs(0);
    setIdleWarning(false);
  }, [maxDurationMs]);

  const cancel = useCallback(() => {
    startedAtRef.current = null;
    lastActivityRef.current = null;
    pausedRef.current = false;
    setRemainingMs(null);
    setIdleMs(0);
    setIdleWarning(false);
  }, []);

  const pause = useCallback(() => {
    if (startedAtRef.current === null) return;
    pausedRef.current = true;
  }, []);

  const resume = useCallback(() => {
    if (startedAtRef.current === null) return;
    pausedRef.current = false;
    lastActivityRef.current = Date.now();
    setIdleMs(0);
    setIdleWarning(false);
  }, []);

  const reset = useCallback(() => {
    begin();
  }, [begin]);

  const markActivity = useCallback(() => {
    if (startedAtRef.current === null) return;
    lastActivityRef.current = Date.now();
    setIdleMs(0);
    setIdleWarning(false);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (startedAtRef.current === null || pausedRef.current) return;
      const now = Date.now();

      if (maxDurationMs) {
        const left = Math.max(0, maxDurationMs - (now - startedAtRef.current));
        setRemainingMs(left);
        if (left <= 0 && !firedRef.current.max) {
          firedRef.current.max = true;
          onMaxRef.current();
        }
      }

      if (lastActivityRef.current !== null) {
        const idle = now - lastActivityRef.current;
        setIdleMs(idle);
        if (idle >= idleTimeoutMs && !firedRef.current.idle) {
          firedRef.current.idle = true;
          onIdleRef.current();
        } else {
          setIdleWarning(idle >= idleWarningMs);
        }
      }
    };

    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [maxDurationMs, idleTimeoutMs, idleWarningMs]);

  return { remainingMs, idleMs, idleWarning, markActivity, begin, pause, resume, cancel, reset };
}
