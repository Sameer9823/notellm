"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/types";

/**
 * The app's signature motif. Straight from the brief's own legend: an amber
 * dot ripples outward while a source is being indexed, then settles into a
 * solid teal dot with a short confirming pop the moment it's ready. Failed
 * sources get a static red dot with no motion — motion here means "working."
 */
export function StatusDot({ status, size = "md" }: { status: SourceStatus; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const ring = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";

  if (status === "READY") {
    return (
      <span className="relative inline-flex items-center justify-center">
        <motion.span
          key="ready"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
          className={cn("rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]", dim)}
        />
      </span>
    );
  }

  if (status === "INDEXING" || status === "QUEUED" || status === "UPLOADING") {
    return (
      <span className="relative inline-flex items-center justify-center">
        <AnimatePresence>
          <motion.span
            key="ring"
            className={cn("absolute rounded-full bg-accent/60", ring)}
            animate={{ scale: [1, 2.6], opacity: [0.6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        </AnimatePresence>
        <span className={cn("relative rounded-full bg-accent", dim)} />
      </span>
    );
  }

  // FAILED
  return <span className={cn("rounded-full bg-destructive", dim)} />;
}

export function statusLabel(status: SourceStatus) {
  switch (status) {
    case "UPLOADING":
      return "Uploading";
    case "QUEUED":
      return "Queued";
    case "INDEXING":
      return "Indexing";
    case "READY":
      return "Indexed";
    case "FAILED":
      return "Failed";
  }
}
