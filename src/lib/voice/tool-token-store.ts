"use client";

import { useState, useEffect } from "react";

let currentToolToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function setToolToken(token: string | null) {
  currentToolToken = token;
  listeners.forEach((l) => l(token));
}

export function getToolToken(): string | null {
  return currentToolToken;
}

export function useToolToken() {
  const [token, setToken] = useState<string | null>(currentToolToken);

  useEffect(() => {
    const handler = (next: string | null) => {
      setToken(next);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return token;
}
