"use client";

import { ErrorDisplay } from "@/components/error-display";

export default function SharedNotebookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorDisplay
      error={error}
      reset={reset}
      title="Shared notebook error"
      description="Something went wrong loading this shared notebook. Try again or check the link."
    />
  );
}
