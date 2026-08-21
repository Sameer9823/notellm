"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { SourceType } from "@/types";

/**
 * Shared source-submission logic. Originally lived inline inside
 * AddSourceDialog; pulled out so the sources rail's drag-and-drop can post
 * files the exact same way the dialog's FileDrop does, without duplicating
 * the fetch/toast/error handling.
 */
export function useAddSource(notebookId: string, onAdded: () => void) {
  const [submitting, setSubmitting] = useState(false);

  async function submitJson(body: object) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] || err.error || "Failed to add source");
      }
      toast.success("Source added — indexing now");
      onAdded();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFile(file: File, type: Extract<SourceType, "PDF" | "VTT">) {
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      const res = await fetch(`/api/notebooks/${notebookId}/sources`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to upload file");
      }
      toast.success("Source uploaded — indexing now");
      onAdded();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /** Guesses source type from a dropped file's extension/MIME so drag-and-drop
   *  onto the rail (which has no type picker) can still call submitFile. */
  function inferFileType(file: File): Extract<SourceType, "PDF" | "VTT"> | null {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") return "PDF";
    if (name.endsWith(".vtt") || name.endsWith(".srt") || name.endsWith(".txt")) return "VTT";
    return null;
  }

  return { submitting, submitJson, submitFile, inferFileType };
}