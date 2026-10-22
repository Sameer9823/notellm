"use client";

import { useState, useCallback } from "react";
import { Download, FileDown, FileText, Loader2, AlertCircle } from "lucide-react";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookTitle: string;
  hasMessages: boolean;
  onExport: (options: ExportOptions) => Promise<void>;
}

type ExportOptions = {
  format: "pdf" | "docx";
  sections: string[];
  includeChat: boolean;
  includeCitations: boolean;
  includeSourceText: boolean;
  includeAISummary: boolean;
  includeMemory: boolean;
};

const ALL_SECTIONS = [
  { key: "sources", label: "Sources overview", description: "Table of all indexed sources" },
  { key: "notes", label: "Notes", description: "All pinned notes in creation order" },
  { key: "summary", label: "Summary / Key concepts", description: "Existing study guides, FAQs, briefings" },
  // { key: "roadmap", label: "Learning roadmap", description: "Ordered concepts with keywords & timestamps" },
  { key: "flashcards", label: "Flashcards / Review cards", description: "Q&A pairs grouped by topic" },
  { key: "audio", label: "Audio overview script", description: "Speaker-labelled dialogue" },
  { key: "appendix", label: "Appendix: Full source list", description: "Complete source list with links" },
] as const;

interface CheckboxRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}

function CheckboxRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  disabledReason,
}: CheckboxRowProps) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 cursor-pointer",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <Checkbox
        className="mt-0.5 h-5 w-5 shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-disabled={disabled}
      />
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "block text-sm font-medium",
            disabled && disabledReason && "text-muted-foreground"
          )}
        >
          {label}
        </span>
        {description && (
          <p
            className={cn(
              "mt-0.5 text-xs text-muted-foreground",
              disabled && disabledReason && "opacity-70"
            )}
          >
            {description}
          </p>
        )}
        {disabled && disabledReason && !description && (
          <p className="mt-0.5 text-xs text-muted-foreground">({disabledReason})</p>
        )}
      </div>
    </label>
  );
}

CheckboxRow.displayName = "CheckboxRow";

export function ExportDialog({ open, onOpenChange, notebookTitle, hasMessages, onExport }: ExportDialogProps) {
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  const [sections, setSections] = useState<string[]>(ALL_SECTIONS.map((s) => s.key));
  const [includeChat, setIncludeChat] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(false);
  const [includeSourceText, setIncludeSourceText] = useState(false);
  const [includeAISummary, setIncludeAISummary] = useState(false);
  const [includeMemory, setIncludeMemory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSection = useCallback((key: string) => {
    setSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const allSelected = sections.length === ALL_SECTIONS.length;
  const selectAllSections = useCallback(() => {
    setSections(allSelected ? [] : ALL_SECTIONS.map((s) => s.key));
  }, [allSelected]);

  const handleExport = useCallback(async () => {
    if (sections.length === 0) {
      setError("Select at least one section to export");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onExport({ format, sections, includeChat, includeCitations, includeSourceText, includeAISummary, includeMemory });
      toast.success(`Exported ${notebookTitle} as ${format.toUpperCase()}`);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [sections, format, includeChat, includeCitations, includeSourceText, includeAISummary, includeMemory, notebookTitle, onExport, onOpenChange]);

  if (!open) return null;

  const selectedCount = sections.length;
  const totalCount = ALL_SECTIONS.length;
  const canDownload = sections.length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-[95vw] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 flex flex-col max-h-[calc(100dvh-2rem)] p-0">
        <DialogHeader className="border-b border-border px-6 py-4 shrink-0">
          <DialogTitle>Export &ldquo;{notebookTitle}&rdquo;</DialogTitle>
          <DialogDescription>
            Choose format, sections, and options. The file will download automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Format</Label>
              <div className="flex gap-3">
                <Button
                  variant={format === "pdf" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFormat("pdf")}
                >
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                <Button
                  variant={format === "docx" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFormat("docx")}
                >
                  <FileText className="h-4 w-4" /> DOCX
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Sections</Label>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {selectedCount} of {totalCount} selected
                  </span>
                  <Button variant="ghost" size="sm" onClick={selectAllSections}>
                    {allSelected ? "Clear" : "Select all"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {ALL_SECTIONS.map((s) => (
                  <CheckboxRow
                    key={s.key}
                    label={s.label}
                    description={s.description}
                    checked={sections.includes(s.key)}
                    onCheckedChange={() => toggleSection(s.key)}
                  />
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-medium">Options</Label>
              <div className="space-y-2">
                <CheckboxRow
                  label="Include chat history"
                  description={hasMessages ? "Chat messages from this session" : undefined}
                  checked={includeChat}
                  onCheckedChange={setIncludeChat}
                  disabled={!hasMessages}
                  disabledReason={!hasMessages ? "no messages" : undefined}
                />
                <CheckboxRow
                  label="Include citations as footnotes"
                  description="Reference links in small print"
                  checked={includeCitations}
                  onCheckedChange={setIncludeCitations}
                />
                <CheckboxRow
                  label="Include full source text"
                  description="May produce a very large file"
                  checked={includeSourceText}
                  onCheckedChange={setIncludeSourceText}
                />
                <CheckboxRow
                  label="Generate AI summary if missing"
                  description="Calls OpenAI for additional cost"
                  checked={includeAISummary}
                  onCheckedChange={setIncludeAISummary}
                />
                <CheckboxRow
                  label="Include memory items"
                  description="Your saved memory snippets"
                  checked={includeMemory}
                  onCheckedChange={setIncludeMemory}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-card px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {selectedCount} of {totalCount} selected
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={handleExport}
                disabled={!canDownload}
                className="w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Downloading…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download {format.toUpperCase()}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
