"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode } from "react";

/**
 * Theme provider. Always wraps children in <ThemeProvider> on every render
 * (server and client). The previous `mounted` gate rendered bare children
 * first, then swapped the root element type to <ThemeProvider> after the
 * first effect — which unmounts and remounts the entire tree (including
 * ClerkProvider, causing Clerk to initialise twice) and makes next-themes'
 * injected <script> flicker. <html suppressHydrationWarning> is already set
 * in src/app/layout.tsx, so an undefined `resolvedTheme` on the first render
 * is safe.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      storageKey="footnote-theme"
    >
      {children}
    </ThemeProvider>
  );
}
