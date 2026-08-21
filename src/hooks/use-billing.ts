"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreditsInfo } from "@/hooks/use-credits";

export type CreditPack = { id: string; name: string; credits: number; priceUsd: number; badge?: string };
export type SubscriptionPlan = { id: string; name: string; monthlyCredits: number; priceUsd: number; blurb: string; badge?: string };
export type SubscriptionDTO = {
  status: string;
  planId: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
} | null;

export type BillingSummary = {
  freeCredits: CreditsInfo;
  purchasedBalance: number;
  subscription: SubscriptionDTO;
  packs: CreditPack[];
  plans: SubscriptionPlan[];
};

export function useBilling() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/summary", { cache: "no-store" });
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkout = useCallback(async (kind: "pack" | "subscription", id: string) => {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Couldn't start checkout");
    }
    const { url }: { url: string } = await res.json();
    window.location.href = url;
  }, []);

  const openPortal = useCallback(async () => {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Couldn't open billing portal");
    }
    const { url }: { url: string } = await res.json();
    window.location.href = url;
  }, []);

  return { summary, loading, reload: load, checkout, openPortal };
}
