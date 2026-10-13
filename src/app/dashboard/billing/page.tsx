"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Zap, CreditCard, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useBilling } from "@/hooks/use-billing";

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const { summary, loading, checkout, openPortal } = useBilling();
  const [busyId, setBusyId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const checkoutState = searchParams.get("checkout");
    if (checkoutState === "success") toast.success("Payment successful — credits are on the way.");
    if (checkoutState === "cancelled") toast.info("Checkout cancelled");
  }, [searchParams]);

  async function handleCheckout(kind: "pack" | "subscription", id: string) {
    setBusyId(id);
    try {
      await checkout(kind, id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout");
      setBusyId(null);
    }
  }

  async function handlePortal() {
    setBusyId("portal");
    try {
      await openPortal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open billing portal");
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-grid">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-display text-lg font-semibold">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            <Logo className="h-5 w-5 text-primary" />
            Billing
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        )}

        {!loading && summary && (
          <>
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Free credits" value={`${summary.freeCredits.balance} / ${summary.freeCredits.max}`} hint={`Resets every ${summary.freeCredits.windowHours}h`} />
              <StatCard label="Purchased balance" value={String(summary.purchasedBalance)} hint="Never expires" />
              <StatCard
                label="Subscription"
                value={summary.subscription ? summary.subscription.planId : "None"}
                hint={summary.subscription ? summary.subscription.status : "Choose a plan below"}
              />
            </div>

            {summary.isStripeConfigured && summary.subscription && (
              <div className="mb-8 flex items-center justify-between rounded-xl border border-border bg-card/40 p-4">
                <div>
                  <p className="text-sm font-medium">
                    {summary.subscription.status === "ACTIVE" ? "Active subscription" : summary.subscription.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summary.subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"} on{" "}
                    {new Date(summary.subscription.currentPeriodEnd).toLocaleDateString()}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handlePortal} disabled={busyId === "portal"}>
                  {busyId === "portal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                  Manage
                </Button>
              </div>
            )}

            {summary.isStripeConfigured && (
              <>
                <section className="mb-10">
                  <h2 className="mb-3 font-display text-sm font-semibold">Subscribe monthly</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {summary.plans.map((plan) => (
                      <div key={plan.id} className={cn("relative rounded-xl border border-border bg-card/40 p-5", plan.badge && "border-primary/50")}>
                        {plan.badge && <Badge className="absolute -top-2 right-4">{plan.badge}</Badge>}
                        <h3 className="font-display text-base font-semibold">{plan.name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{plan.blurb}</p>
                        <p className="mt-3 text-2xl font-semibold">
                          ${plan.priceUsd}
                          <span className="text-sm font-normal text-muted-foreground">/mo</span>
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="h-3 w-3" /> {plan.monthlyCredits.toLocaleString()} credits / month
                        </p>
                        <Button
                          className="mt-4 w-full"
                          onClick={() => handleCheckout("subscription", plan.id)}
                          disabled={busyId === plan.id || summary.subscription?.planId === plan.id}
                        >
                          {busyId === plan.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : summary.subscription?.planId === plan.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : null}
                          {summary.subscription?.planId === plan.id ? "Current plan" : "Subscribe"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h2 className="mb-3 font-display text-sm font-semibold">One-time top-ups</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {summary.packs.map((pack) => (
                      <div key={pack.id} className={cn("relative rounded-xl border border-border bg-card/40 p-5", pack.badge && "border-primary/50")}>
                        {pack.badge && <Badge className="absolute -top-2 right-4">{pack.badge}</Badge>}
                        <h3 className="font-display text-base font-semibold">{pack.name}</h3>
                        <p className="mt-3 text-2xl font-semibold">${pack.priceUsd}</p>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="h-3 w-3" /> {pack.credits.toLocaleString()} credits
                        </p>
                        <Button variant="outline" className="mt-4 w-full" onClick={() => handleCheckout("pack", pack.id)} disabled={busyId === pack.id}>
                          {busyId === pack.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Buy
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

        {!loading && !summary?.isStripeConfigured && (
          <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Billing is not configured yet. Contact an administrator to enable paid credit packs and subscriptions.
            </p>
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
