"use client";

import { useCallback, useEffect, useState } from "react";

export type MemoryDTO = {
  id: string;
  memory: string;
  source: "MANUAL" | "LEARNED";
  createdAt: string;
  updatedAt: string;
};

export function useMemories() {
  const [memories, setMemories] = useState<MemoryDTO[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memory", { cache: "no-store" });
      if (res.ok) setMemories((await res.json()).memories);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async (memory: string) => {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save memory");
    }
    const { memory: created }: { memory: MemoryDTO } = await res.json();
    setMemories((prev) => (prev ? [created, ...prev] : [created]));
  }, []);

  const update = useCallback(async (id: string, memory: string) => {
    const res = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update memory");
    }
    const { memory: updated }: { memory: MemoryDTO } = await res.json();
    setMemories((prev) => (prev ? prev.map((m) => (m.id === id ? updated : m)) : prev));
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete memory");
    }
    setMemories((prev) => (prev ? prev.filter((m) => m.id !== id) : prev));
  }, []);

  return { memories, loading, create, update, remove };
}
