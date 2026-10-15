"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, Monitor, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const ACCENTS = [
  { value: "teal", label: "Teal", description: "Indexed / Success" },
  { value: "amber", label: "Amber", description: "Indexing / In Progress" },
  { value: "violet", label: "Violet", description: "Creative / AI" },
  { value: "rose", label: "Rose", description: "Attention / Urgent" },
  { value: "sky", label: "Sky", description: "Calm / Info" },
  { value: "emerald", label: "Emerald", description: "Growth / Positive" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [accent, setAccent] = useState("teal");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("footnote-accent");
    if (saved && ACCENTS.some((a) => a.value === saved)) {
      setAccent(saved);
      document.documentElement.setAttribute("data-accent", saved);
    } else {
      document.documentElement.setAttribute("data-accent", "teal");
    }
  }, []);

  const handleAccentChange = (value: string) => {
    setAccent(value);
    localStorage.setItem("footnote-accent", value);
    document.documentElement.setAttribute("data-accent", value);
  };

  if (!mounted) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
          <Palette className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Theme settings"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="space-y-2 p-1">
          <h4 className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Appearance
          </h4>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem
              key={value}
              onSelect={() => setTheme(value)}
              className={cn(
                "flex items-center gap-2",
                theme === value && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {theme === value && (
                <span className="ml-auto text-xs">Active</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <h4 className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Accent Color
          </h4>
          <div className="grid grid-cols-3 gap-1 px-1">
            {ACCENTS.map(({ value, label, description }) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => handleAccentChange(value)}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-colors",
                  accent === value
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:bg-secondary/50",
                )}
              >
                <div
                  className="h-5 w-5 rounded-full border border-border transition-transform"
                  style={{
                    backgroundColor: `hsl(var(--primary))`,
                  }}
                />
                <span className="text-[10px] font-medium truncate w-full text-center">
                  {label}
                </span>
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                  {description}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
