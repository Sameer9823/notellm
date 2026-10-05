"use client";

import { useRef, useEffect } from "react";
import type { VoiceState } from "@/lib/voice/types";

const STROKES = 112;
type Rgb = [number, number, number];

const PALETTES: Record<"light" | "dark", { user: Rgb; assistant: Rgb; neutral: Rgb }> = {
  light: { user: [0x35, 0x50, 0xe8], assistant: [0xd6, 0x86, 0x10], neutral: [0x7a, 0x83, 0x99] },
  dark: { user: [0x7c, 0x93, 0xff], assistant: [0xf5, 0xb6, 0x55], neutral: [0x74, 0x7e, 0xa4] },
};

type Mode = "user" | "assistant" | "comet" | "breath" | "still";

const MODES: Record<VoiceState, Mode> = {
  idle: "breath",
  connecting: "breath",
  reconnecting: "breath",
  listening: "breath",
  user_speaking: "user",
  speaking: "assistant",
  assistant_speaking: "assistant",
  interrupting: "user",
  interrupted: "still",
  thinking: "comet",
  error: "still",
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

export interface VoiceOrbProps {
  state: VoiceState;
  micLevel: () => number;
  assistantLevel: () => number;
  size?: number;
  active: boolean;
}

export function VoiceOrb({ state, micLevel, assistantLevel, size = 220, active }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const activeRef = useRef(active);
  const micRef = useRef(micLevel);
  const assistantRef = useRef(assistantLevel);
  const reducedMotionRef = useRef(false);
  const darkRef = useRef(false);

  stateRef.current = state;
  activeRef.current = active;
  micRef.current = micLevel;
  assistantRef.current = assistantLevel;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    reducedMotionRef.current = reduced.matches;
    darkRef.current = dark.matches;

    const onReduced = (event: MediaQueryListEvent) => { reducedMotionRef.current = event.matches; };
    const onDark = (event: MediaQueryListEvent) => { darkRef.current = event.matches; };
    reduced.addEventListener?.("change", onReduced);
    dark.addEventListener?.("change", onDark);
    return () => {
      reduced.removeEventListener?.("change", onReduced);
      dark.removeEventListener?.("change", onDark);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - size * 0.13;
    const trackLength = size * 0.05;
    const maxLength = size * 0.15;
    const lineWidth = Math.max(1.5, size * 0.009);

    let colour: Rgb = PALETTES.light.neutral;
    let startedAt = performance.now();

    const targetColour = (mode: Mode, palette: typeof PALETTES.light): Rgb => {
      if (mode === "user") return palette.user;
      if (mode === "assistant") return palette.assistant;
      return palette.neutral;
    };

    const draw = (now: number) => {
      const palette = PALETTES[darkRef.current ? "dark" : "light"];
      const mode = MODES[stateRef.current];
      const elapsed = (now - startedAt) / 1000;
      const reduced = reducedMotionRef.current;

      colour = lerpRgb(colour, targetColour(mode, palette), reduced ? 1 : 0.12);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineWidth = lineWidth * ratio;

      const level = mode === "user" ? micRef.current() : mode === "assistant" ? assistantRef.current() : 0;
      const useLevel = !reduced && (mode === "user" || mode === "assistant");

      for (let i = 0; i < STROKES; i++) {
        const angle = (i / STROKES) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        let length = trackLength;
        let alpha = 0.42;

        if (useLevel) {
          const variation = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(i * 0.73 + elapsed * 2.1));
          length = trackLength + level * maxLength * variation;
          alpha = 0.55 + 0.45 * level;
        } else if (mode === "comet" && !reduced) {
          const head = ((elapsed / 1.6) % 1) * STROKES;
          const behind = (head - i + STROKES) % STROKES;
          const proximity = 1 - behind / (STROKES * 0.42);
          if (proximity > 0) {
            const eased = proximity * proximity;
            length = trackLength + maxLength * 0.62 * eased;
            alpha = 0.4 + 0.6 * eased;
          }
        } else if (mode === "breath" && !reduced) {
          const breath = 0.5 + 0.5 * Math.sin(elapsed * 1.1);
          length = trackLength + maxLength * 0.16 * breath;
          alpha = 0.5 + 0.2 * breath;
        } else if (activeRef.current && !reduced && mode === "still") {
          length = trackLength + maxLength * 0.05;
          alpha = 0.42;
        }

        const inner = radius - length / 2;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = `rgb(${colour[0] | 0}, ${colour[1] | 0}, ${colour[2] | 0})`;
        ctx.beginPath();
        ctx.moveTo((cx + cos * inner) * ratio, (cy + sin * inner) * ratio);
        ctx.lineTo((cx + cos * (inner + length)) * ratio, (cy + sin * (inner + length)) * ratio);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    if (reducedMotionRef.current) {
      startedAt = performance.now();
      draw(startedAt);
      const onDarkChange = () => {
        startedAt = performance.now();
        draw(startedAt);
      };
      const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
      dark?.addEventListener?.("change", onDarkChange);
      return () => dark?.removeEventListener?.("change", onDarkChange);
    }

    let frame = 0;
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [size, state]);

  return (
    <canvas
      ref={canvasRef}
      className="ring-canvas"
      style={{ width: size, height: size }}
      role="presentation"
      aria-hidden="true"
    />
  );
}
