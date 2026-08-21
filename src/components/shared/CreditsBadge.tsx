"use client";

import { formatDistanceToNow } from "date-fns";
import { Zap } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CreditsInfo } from "@/hooks/use-credits";

export function CreditsBadge({ credits, loading }: { credits: CreditsInfo | null; loading: boolean }) {
  if (loading && !credits) {
    return <Skeleton className="h-7 w-24 rounded-full" />;
  }
  if (!credits) return null;

  const ratio = credits.max > 0 ? credits.balance / credits.max : 0;
  const isOut = credits.balance <= 0;
  const isLow = !isOut && ratio <= 0.2;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
              isOut
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : isLow
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border bg-secondary/40 text-foreground"
            )}
          >
            <Zap className={cn("h-3.5 w-3.5", isOut ? "text-destructive" : isLow ? "text-accent" : "text-primary")} />
            <span>
              {credits.balance}
              <span className="text-muted-foreground">/{credits.max}</span>
            </span>
            <span className="hidden sm:inline text-muted-foreground">credits</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-center">
          {isOut ? (
            <p>
              Out of credits — refreshes {formatDistanceToNow(credits.resetAt, { addSuffix: true })}.
            </p>
          ) : (
            <p>
              {credits.balance} of {credits.max} credits left this window. Refreshes{" "}
              {formatDistanceToNow(credits.resetAt, { addSuffix: true })} (every {credits.windowHours}h).
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
