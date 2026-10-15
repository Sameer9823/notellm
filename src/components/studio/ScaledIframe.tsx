"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export type ViewMode = "desktop" | "tablet" | "mobile";

export const VIRTUAL_WIDTH: Record<ViewMode, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

type Props = {
  src: string;
  title: string;
  mode?: ViewMode;
  onSlow?: () => void;
  reloadKey?: number;
};

/**
 * Renders an `<iframe>` at its real (virtual) pixel dimensions and scales it
 * down with `transform: scale()` to fit the available box — WITHOUT using any
 * percentage heights (percent heights resolve to `auto` for iframes when an
 * ancestor's height isn't definite, which previously collapsed the viewer to a
 * 150px strip). All sizing is read from the measured box via a ResizeObserver,
 * so the box only ever needs `flex-1` / `absolute inset-0` to be definite.
 */
export function ScaledIframe({ src, title, mode = "desktop", onSlow, reloadKey }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [spinnerDone, setSpinnerDone] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Measure the box once and whenever it resizes.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-arm the "loading" / "slow site" timers whenever the actual page navigates.
  useEffect(() => {
    setSpinnerDone(false);
    setLoaded(false);
    loadedRef.current = false;

    const spinner = setTimeout(() => setSpinnerDone(true), 3000);
    const slow = setTimeout(() => {
      if (!loadedRef.current) onSlow?.();
    }, 10000);

    return () => {
      clearTimeout(spinner);
      clearTimeout(slow);
    };
  }, [src, onSlow]);

  const target = VIRTUAL_WIDTH[mode];
  const ready = box.w > 0 && box.h > 0;
  // Scale down when the panel is narrower than the virtual viewport; never up.
  const scale = ready ? Math.min(1, box.w / target) : 1;
  // A wide desktop panel simply fills the available width instead of capping it.
  const frameW = mode === "desktop" && ready && box.w > target ? box.w : target;
  // Pixel height (NOT a percentage): frameH/scale after the transform == box.h.
  const frameH = ready ? Math.ceil(box.h / scale) : 0;
  const offsetX = mode === "mobile" ? Math.max(0, (box.w - target) / 2) : 0;

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-background">
      {!loaded && !spinnerDone && (
        <div
          data-testid="web-viewer-loading"
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-xs text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading site…
        </div>
      )}
      {ready && (
        <iframe
          key={`${src}-${reloadKey}`}
          src={src}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setLoaded(true);
            loadedRef.current = true;
          }}
          style={{
            position: "absolute",
            left: offsetX,
            top: 0,
            width: frameW,
            height: frameH,
            border: 0,
            background: "#fff",
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      )}
    </div>
  );
}
