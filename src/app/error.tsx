"use client";

import { ErrorDisplay } from "@/components/error-display";

export default function RootError({
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
      title="Something went wrong"
      description="An unexpected error occurred. You can try again or refresh the page."
    />
  );
}
