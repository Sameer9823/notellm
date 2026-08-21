"use client";

import { useEffect, useState, useCallback } from "react";
import type { NoteDTO } from "@/types";

/** Loads a notebook's pinned notes and exposes create/delete — no polling
 *  needed since notes only change in response to direct user action. */
export function useNotes(notebookId: string) {
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/notes`, { cache: "no-store" });
      if (res.ok) setNotes((await res.json()).notes ?? []);
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    load();
  }, [load]);

  const addNote = useCallback(
    async (content: string, citations?: NoteDTO["citations"]) => {
      const res = await fetch(`/api/notebooks/${notebookId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, citations }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save note");
      }
      const { note } = await res.json();
      setNotes((prev) => [note, ...prev]);
      return note as NoteDTO;
    },
    [notebookId]
  );

  const deleteNote = useCallback(async (noteId: string) => {
    const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete note");
    }
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }, []);

  return { notes, loading, addNote, deleteNote, reload: load };
}