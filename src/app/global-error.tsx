"use client";

import { ErrorDisplay } from "@/components/error-display";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorDisplay
          error={error}
          reset={reset}
          title="App error"
          description="A critical error prevented the page from loading. Reloading may fix it."
        />
      </body>
    </html>
  );
}
