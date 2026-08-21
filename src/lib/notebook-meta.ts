import {
  Library,
  BookOpen,
  Brain,
  Lightbulb,
  FlaskConical,
  Rocket,
  Briefcase,
  GraduationCap,
  Music,
  Code,
  Newspaper,
  Palette,
  type LucideIcon,
} from "lucide-react";

/** Every notebook.icon value maps to one of these. Unknown/legacy values
 *  (or notebooks created before this feature existed) fall back to Library. */
export const NOTEBOOK_ICONS: Record<string, LucideIcon> = {
  notebook: Library,
  book: BookOpen,
  brain: Brain,
  idea: Lightbulb,
  research: FlaskConical,
  launch: Rocket,
  work: Briefcase,
  study: GraduationCap,
  music: Music,
  code: Code,
  news: Newspaper,
  design: Palette,
};

export function notebookIcon(icon: string | undefined | null): LucideIcon {
  return (icon && NOTEBOOK_ICONS[icon]) || Library;
}

/** Ordered list for the picker UI. */
export const NOTEBOOK_ICON_OPTIONS = Object.keys(NOTEBOOK_ICONS);

/** Tailwind gradient classes per accent color, used for the card background.
 *  Keep this in sync with NOTEBOOK_COLOR_OPTIONS below. */
export const NOTEBOOK_COLORS: Record<string, string> = {
  teal: "from-primary/25 via-primary/5 to-transparent",
  amber: "from-accent/25 via-accent/5 to-transparent",
  violet: "from-violet-400/25 via-violet-400/5 to-transparent",
  rose: "from-rose-400/25 via-rose-400/5 to-transparent",
  sky: "from-sky-400/25 via-sky-400/5 to-transparent",
  emerald: "from-emerald-400/25 via-emerald-400/5 to-transparent",
};

/** Solid swatch classes for the picker UI (the gradients above are too
 *  subtle to read at swatch size). */
export const NOTEBOOK_COLOR_SWATCH: Record<string, string> = {
  teal: "bg-primary",
  amber: "bg-accent",
  violet: "bg-violet-400",
  rose: "bg-rose-400",
  sky: "bg-sky-400",
  emerald: "bg-emerald-400",
};

export const NOTEBOOK_COLOR_OPTIONS = Object.keys(NOTEBOOK_COLORS);

/** Solid text-color classes matching each accent, used to tint the card's
 *  icon chip so a notebook's chosen color actually shows up somewhere
 *  besides the (very subtle) background gradient. */
export const NOTEBOOK_COLOR_TEXT: Record<string, string> = {
  teal: "text-primary",
  amber: "text-accent",
  violet: "text-violet-400",
  rose: "text-rose-400",
  sky: "text-sky-400",
  emerald: "text-emerald-400",
};

/** Matching low-opacity background for the icon chip itself. */
export const NOTEBOOK_COLOR_CHIP_BG: Record<string, string> = {
  teal: "bg-primary/12",
  amber: "bg-accent/12",
  violet: "bg-violet-400/12",
  rose: "bg-rose-400/12",
  sky: "bg-sky-400/12",
  emerald: "bg-emerald-400/12",
};

export function notebookAccent(color: string | undefined | null): string {
  return (color && NOTEBOOK_COLORS[color]) || NOTEBOOK_COLORS.teal;
}

export function notebookColorText(color: string | undefined | null): string {
  return (color && NOTEBOOK_COLOR_TEXT[color]) || NOTEBOOK_COLOR_TEXT.teal;
}

export function notebookChipBg(color: string | undefined | null): string {
  return (color && NOTEBOOK_COLOR_CHIP_BG[color]) || NOTEBOOK_COLOR_CHIP_BG.teal;
}