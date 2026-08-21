"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function ShareDialog({
  notebookId,
  open,
  onOpenChange,
  initialIsPublic,
  initialSlug,
}: {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIsPublic: boolean;
  initialSlug: string | null | undefined;
}) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [slug, setSlug] = useState(initialSlug ?? null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = slug && typeof window !== "undefined" ? `${window.location.origin}/shared/${slug}` : "";

  async function enable() {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/share`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setIsPublic(true);
      setSlug(data.shareSlug);
    } catch {
      toast.error("Couldn't create the share link — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${notebookId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setIsPublic(false);
    } catch {
      toast.error("Couldn't turn off sharing — try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share notebook</DialogTitle>
          <DialogDescription>
            Anyone with the link can view sources and the existing conversation — read-only. They
            can&apos;t ask new questions, edit, or see your other notebooks.
          </DialogDescription>
        </DialogHeader>

        {isPublic && shareUrl ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={shareUrl} className="text-sm" onFocus={(e) => e.currentTarget.select()} />
            <Button size="icon" variant="outline" onClick={copyLink} title="Copy link">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This notebook isn&apos;t shared yet.</p>
        )}

        <DialogFooter>
          {isPublic ? (
            <Button variant="outline" onClick={disable} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
              Turn off sharing
            </Button>
          ) : (
            <Button onClick={enable} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create share link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}