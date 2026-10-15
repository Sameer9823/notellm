"use client";

import { ErrorDisplay } from "@/components/error-display";

export default function NotebookError({
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
      title="Notebook error"
      description="Something went wrong while loading this notebook. Try again or go back to your dashboard."
    />
  );
}
