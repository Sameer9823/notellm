"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { MoreVertical, Pencil, Trash2, Library, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { notebookIcon, notebookAccent, notebookColorText, notebookChipBg } from "@/lib/notebook-meta";
import type { NotebookDTO } from "@/types";

export function NotebookCard({
  notebook,
  onRename,
  onDelete,
}: {
  notebook: NotebookDTO;
  onRename: () => void;
  onDelete: () => void;
}) {
  const Icon = notebookIcon(notebook.icon);
  const sourceCount = notebook._count?.sources ?? 0;

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -3 }}>
      <Card className="group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-lg hover:shadow-black/20">
        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${notebookAccent(notebook.color)}`} />
        <Link href={`/notebook/${notebook.id}`} className="relative flex flex-1 flex-col p-5">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${notebookChipBg(notebook.color)}`}
          >
            <Icon className={`h-4 w-4 ${notebookColorText(notebook.color)}`} />
          </div>
          <h3 className="mt-4 truncate font-display text-base font-semibold">{notebook.title}</h3>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] flex-1 text-sm text-muted-foreground">
            {notebook.description || "No description yet."}
          </p>
          <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Library className="h-3 w-3" />
              {sourceCount} {sourceCount === 1 ? "source" : "sources"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(notebook.updatedAt), { addSuffix: true })}
            </span>
          </div>
        </Link>

        <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md bg-card/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="h-3.5 w-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
    </motion.div>
  );
}