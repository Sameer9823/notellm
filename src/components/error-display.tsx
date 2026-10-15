"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, RefreshCw } from "lucide-react";

export function ErrorDisplay({
  error,
  reset,
  className,
  title = "Something went wrong",
  description,
}: {
  error?: Error & { digest?: string };
  reset?: () => void;
  className?: string;
  title?: string;
  description?: string;
}) {
  const digest = error?.digest ?? "unknown";
  const message = error?.message;
  const isProd = process.env.NODE_ENV === "production";

  return (
    <div
      className={cn(
        "flex min-h-[400px] flex-col items-center justify-center gap-4 p-6 text-center",
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-md">{description}</p>
        )}
        {message && !isProd && (
          <pre className="mt-4 max-w-lg overflow-x-auto rounded-md bg-secondary/50 p-4 text-left text-xs">
            {message}
          </pre>
        )}
        <p className="text-xs text-muted-foreground">
          Error digest: <code className="font-mono">{digest}</code>
          <br />
          Quote this when contacting support.
        </p>
      </div>
      {reset && (
        <Button onClick={reset} variant="default" className="mt-2">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}
