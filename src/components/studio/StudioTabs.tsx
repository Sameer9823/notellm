"use client";

import { Headphones, Map, GraduationCap, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

export type StudioTabId = "audio" | "roadmap" | "study" | "notes";

const TABS: { id: StudioTabId; label: string; icon: typeof Headphones }[] = [
  { id: "audio", label: "Audio", icon: Headphones },
  { id: "roadmap", label: "Roadmap", icon: Map },
  { id: "study", label: "Study", icon: GraduationCap },
  { id: "notes", label: "Notes", icon: StickyNote },
];

/**
 * Slim pill tab-strip rendered inside every Studio panel (Audio, Roadmap,
 * Study tools, Notes) so switching between them is one tap instead of
 * closing the current panel and hunting for the right header icon. All
 * four panels stay independent components — this is just a shared,
 * consistent way to jump between them.
 */
export function StudioTabs({ active, onSelect }: { active: StudioTabId; onSelect: (id: StudioTabId) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-border bg-secondary/10 px-2 py-1.5">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
