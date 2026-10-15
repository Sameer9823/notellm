"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  keys?: string[];
}

export function Kbd({ className, keys, children, ...props }: KbdProps) {
  if (keys && keys.length > 0) {
    return (
      <span
        className={cn("inline-flex items-center gap-1", className)}
        {...props}
      >
        {keys.map((key, i) => (
          <kbd
            key={key}
            className={cn(
              "inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 text-[11px] font-mono font-medium",
              keys.length > 1 && i < keys.length - 1 && "mr-0.5",
            )}
          >
            {key}
          </kbd>
        ))}
        {keys.length > 1 && <span className="text-muted-foreground">+</span>}
      </span>
    );
  }

  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 text-[11px] font-mono font-medium",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
