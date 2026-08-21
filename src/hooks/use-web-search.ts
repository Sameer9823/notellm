"use client";

import { useState } from "react";
import { toast } from "sonner";

export type WebSearchResult = { title: string; url: string; snippet: string };

export function useWebSearch(notebookId: string, onAdded: () => void) {
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<WebSearchResult[] | null>(null);

  async function search(query: string) {
    setSearching(true);
    setResults(null);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/websearch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] || err.error || "Web search failed");
      }
      const data = await res.json();
      setResults(data.results ?? []);
      if (!data.results?.length) toast.info("No results found — try a different query");
      return data.results as WebSearchResult[];
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setResults([]);
      return [];
    } finally {
      setSearching(false);
    }
  }

  async function addSelected(picked: WebSearchResult[]) {
    if (picked.length === 0) return false;
    setAdding(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/websearch`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: picked.map((r) => ({ url: r.url, title: r.title })) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.formErrors?.[0] || err.error || "Couldn't add sources");
      }
      const data = await res.json();
      const count = data.created?.length ?? 0;
      toast.success(count === 1 ? "Source added — indexing now" : `${count} sources added — indexing now`);
      if (data.skipped > 0) toast.warning(`${data.skipped} skipped — out of credits`);
      onAdded();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setAdding(false);
    }
  }

  function reset() {
    setResults(null);
  }

  return { searching, adding, results, search, addSelected, reset };
}
