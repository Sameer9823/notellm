"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Search, Plus, FileText, Link, Youtube, Sparkles, Headphones, Map, GraduationCap, StickyNote, Palette, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  onAddSource: () => void;
  onToggleTheme: () => void;
  onNewNotebook: () => void;
  onFocusChat: () => void;
  notebooks?: { id: string; title: string }[];
  onSwitchNotebook: (id: string) => void;
}

export function CommandPalette({
  onAddSource,
  onToggleTheme,
  onNewNotebook,
  onFocusChat,
  notebooks = [],
  onSwitchNotebook,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleAction = useCallback((action: () => void) => {
    action();
    setOpen(false);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-1/4 left-1/2 z-50 w-[600px] max-w-[90vw] -translate-x-1/2"
            onClick={(e) => e.stopPropagation()}
          >
            <Command className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <CommandInput placeholder="Type a command or search…" />
                <Kbd keys={["⌘", "K"]} className="ml-auto" />
              </div>
              <CommandList>
                <CommandGroup heading="Navigation">
                  <CommandItem onSelect={() => handleAction(onFocusChat)}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Focus chat input
                    <CommandShortcut><Kbd keys={["⌘", "L"]} /></CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(onAddSource)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add source
                    <CommandShortcut><Kbd keys={["⌘", "Shift", "A"]} /></CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(onNewNotebook)}>
                    <FileText className="h-4 w-4 mr-2" />
                    New notebook
                    <CommandShortcut><Kbd keys={["⌘", "N"]} /></CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(onToggleTheme)}>
                    <Palette className="h-4 w-4 mr-2" />
                    Toggle theme
                    <CommandShortcut><Kbd keys={["⌘", "Shift", "T"]} /></CommandShortcut>
                  </CommandItem>
                </CommandGroup>

                {notebooks.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Notebooks">
                      {notebooks.map((nb) => (
                        <CommandItem
                          key={nb.id}
                          onSelect={() => {
                            onSwitchNotebook(nb.id);
                            setOpen(false);
                          }}
                        >
                          <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                          {nb.title}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                <CommandSeparator />
                <CommandGroup heading="Studio tools">
                  <CommandItem onSelect={() => handleAction(() => { /* Audio overview */ })}>
                    <Headphones className="h-4 w-4 mr-2" />
                    Audio overview
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(() => { /* Roadmap */ })}>
                    <Map className="h-4 w-4 mr-2" />
                    Learning roadmap
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(() => { /* Study tools */ })}>
                    <GraduationCap className="h-4 w-4 mr-2" />
                    Study tools
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(() => { /* Notes */ })}>
                    <StickyNote className="h-4 w-4 mr-2" />
                    Notes
                  </CommandItem>
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup heading="Add source">
                  <CommandItem onSelect={() => handleAction(() => { /* PDF */ })}>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF file
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(() => { /* Web link */ })}>
                    <Link className="h-4 w-4 mr-2" />
                    Web link
                  </CommandItem>
                  <CommandItem onSelect={() => handleAction(() => { /* YouTube */ })}>
                    <Youtube className="h-4 w-4 mr-2" />
                    YouTube video
                  </CommandItem>
                </CommandGroup>

                <CommandEmpty>No commands found.</CommandEmpty>
              </CommandList>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}