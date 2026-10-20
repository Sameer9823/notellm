"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. The initial value is read synchronously on
 * the first client render (no hydration flash), and a listener keeps the
 * value in sync as the viewport changes.
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return defaultValue;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** True when the viewport is below the `md` breakpoint (Tailwind < 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
