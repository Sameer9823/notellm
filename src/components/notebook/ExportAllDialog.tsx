"use client";

import { useState } from "react";
import { Download, Loader2, FileText, FileDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ExportAllDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExportAll: () => Promise<void>;
  loading: boolean;
}

export function ExportAllDialog({ open, onOpenChange, onExportAll, loading }: ExportAllDialogProps) {
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [includeChat, setIncludeChat] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeSourceText, setIncludeSourceText] = useState(false);
  const [includeAISummary, setIncludeAISummary] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(true);
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setLocalLoading(true);
    setError(null);
    try {
      await onExportAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setError(msg);
    } finally {
      setLocalLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export all notebooks</DialogTitle>
          <DialogDescription>
            Exports every notebook you own as a ZIP of PDF or DOCX files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="font-medium">Format</Label>
            <div className="flex gap-3 mt-2">
              <Button
                variant={format === "pdf" ? "default" : "outline"}
                className="flex-1 flex items-center justify-center gap-2"
                onClick={() => setFormat("pdf")}
              >
                <FileDown className="h-4 w-4" /> PDF (ZIP)
              </Button>
              <Button
                variant={format === "docx" ? "default" : "outline"}
                className="flex-1 flex items-center justify-center gap-2"
                onClick={() => setFormat("docx")}
              >
                <FileText className="h-4 w-4" /> DOCX (ZIP)
              </Button>
            </div>
          </div>

          <Separator />

          <div>
            <Label className="font-medium">Options</Label>
            <div className="space-y-2 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={includeChat}
                  onCheckedChange={(v) => setIncludeChat(v as boolean)}
                />
                <span className="text-sm">Include chat history</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={includeCitations}
                  onCheckedChange={(v) => setIncludeCitations(v as boolean)}
                />
                <span className="text-sm">Include citations as footnotes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={includeSourceText}
                  onCheckedChange={(v) => setIncludeSourceText(v as boolean)}
                />
                <span className="text-sm">Include full source text (large)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={includeAISummary}
                  onCheckedChange={(v) => setIncludeAISummary(v as boolean)}
                />
                <span className="text-sm">Generate AI summary if missing</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={includeMemory}
                  onCheckedChange={(v) => setIncludeMemory(v as boolean)}
                />
                <span className="text-sm">Include memory items</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              <X className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || localLoading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={loading || localLoading}>
            {loading || localLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export all as {format.toUpperCase()} ZIP
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}