"use client";

import { Download, FileText, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function ExportMenu({
  onMarkdown,
  onPdf,
  disabled,
  label = "Export",
}: {
  onMarkdown: () => void;
  onPdf: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title={label} disabled={disabled}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onMarkdown}>
          <FileText className="h-3.5 w-3.5" /> Export as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPdf}>
          <FileDown className="h-3.5 w-3.5" /> Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}