"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageDTO } from "@/types";

export interface UseScopeMessagesResult {
  messages: MessageDTO[];
  setMessages: React.Dispatch<React.SetStateAction<MessageDTO[]>>;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  clearChat: () => Promise<void>;
}

/** In-memory cache of loaded message pages per (notebook, scope). This is
 *  intentionally module-level so that a ChatPanel switching between scopes
 *  (All sources / per-source) retains each scope's loaded history and
 *  pagination cursor without re-fetching or flashing unrelated messages when
 *  switching back. */
const scopeCache = new Map<string, { messages: MessageDTO[]; nextCursor: string | null }>();

export function useScopeMessages(
  notebookId: string,
  scopeSourceId: string | null,
  initial: MessageDTO[] = [],
): UseScopeMessagesResult {
  const scopeParam = scopeSourceId ?? "all";
  const cacheKey = `${notebookId}:${scopeParam}`;

  const [messages, setMessages] = useState<MessageDTO[]>(() => {
    const cached = scopeCache.get(cacheKey);
    if (cached) return cached.messages;
    // For the notebook-wide scope we can seed from the server-rendered
    // initial payload; for a specific source we must NOT seed with the
    // notebook-wide list (that would briefly flash other scopes' messages),
    // so start empty and fetch immediately.
    return scopeSourceId == null ? initial : [];
  });
  const [loading, setLoading] = useState(() => !scopeCache.has(cacheKey));
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(
    () => scopeCache.get(cacheKey)?.nextCursor ?? null,
  );

  const prevKeyRef = useRef<string>(cacheKey);

  const fetchRange = useCallback(
    async (cursor: string | null, isLoadMore: boolean) => {
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ sourceId: scopeParam, limit: String(100) });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/notebooks/${notebookId}/messages?${params.toString()}`);
        if (!res.ok) {
          setMessages([]);
          setNextCursor(null);
          return;
        }
        const data = (await res.json()) as { messages: MessageDTO[]; nextCursor: string | null };
        const incoming = (data.messages ?? []).slice().reverse();
        setMessages((prev) => {
          const merged = isLoadMore ? [...incoming, ...prev] : incoming;
          scopeCache.set(cacheKey, { messages: merged, nextCursor: data.nextCursor ?? null });
          return merged;
        });
        setNextCursor(data.nextCursor ?? null);
      } finally {
        if (isLoadMore) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [notebookId, scopeParam, cacheKey],
  );

  const refresh = useCallback(async () => {
    const cached = scopeCache.get(cacheKey);
    if (cached) {
      // Switch back to a scope we already have cached: restore instantly.
      setMessages(cached.messages);
      setNextCursor(cached.nextCursor ?? null);
      setLoading(false);
      return;
    }
    await fetchRange(null, false);
  }, [cacheKey, fetchRange]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return Promise.resolve();
    return fetchRange(nextCursor, true);
  }, [fetchRange, nextCursor, loadingMore]);

  const clearChat = useCallback(async () => {
    const res = await fetch(`/api/notebooks/${notebookId}/messages?sourceId=${encodeURIComponent(scopeParam)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMessages([]);
      setNextCursor(null);
      scopeCache.delete(cacheKey);
    }
  }, [notebookId, scopeParam, cacheKey]);

  // (Re)load when the notebook or scope changes.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, scopeParam]);

  // When the scope changes, snapshot the outgoing scope's latest messages into
  // its own cache slot so they survive the switch (at this commit `messages`
  // still holds the previous scope's content).
  useEffect(() => {
    if (prevKeyRef.current !== cacheKey) {
      scopeCache.set(prevKeyRef.current, { messages, nextCursor });
      prevKeyRef.current = cacheKey;
    }
  }, [cacheKey, messages, nextCursor]);

  // Keep the active scope's cache in sync as the user sends, regenerates, or
  // streams new messages. This runs after every state change and is
  // self-correcting if it fires transiently with stale data during a switch.
  useEffect(() => {
    scopeCache.set(cacheKey, { messages, nextCursor });
  });

  return { messages, setMessages, loading, loadingMore, nextCursor, refresh, loadMore, clearChat };
}
