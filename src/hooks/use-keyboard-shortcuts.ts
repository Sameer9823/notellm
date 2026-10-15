"use client";

import { useEffect } from "react";

type ShortcutHandlers = {
  /** "/" — focus the chat question textarea */
  onFocusChat?: () => void;
  /** "a" — open the Add Source dialog */
  onAddSource?: () => void;
  /** "b" with Cmd/Ctrl — toggle Sources panel */
  onToggleSources?: () => void;
  /** "s" with Cmd/Ctrl — toggle Studio panel */
  onToggleStudio?: () => void;
  /** "f" with Cmd/Ctrl+Shift — toggle Focus mode */
  onFocusMode?: () => void;
  /** Escape — close whatever overlay is currently open */
  onEscape?: () => void;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global notebook-page keyboard shortcuts:
 *  - "/"        focus the chat input (works from anywhere except inside a field)
 *  - "a"        open the Add Source dialog
 *  - "⌘B"       toggle Sources panel
 *  - "⌘S"       toggle Studio panel
 *  - "⌘⇧F"      toggle Focus mode
 *  - Esc        close the topmost open overlay
 */
export function useKeyboardShortcuts({
  onFocusChat,
  onAddSource,
  onToggleSources,
  onToggleStudio,
  onFocusMode,
  onEscape,
}: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }

      const isMac = navigator.platform.includes("Mac");
      const meta = isMac ? e.metaKey : e.ctrlKey;
      const shift = e.shiftKey;

      // Shortcuts with modifiers work even when typing
      if (meta && !shift && e.key.toLowerCase() === "b") {
        e.preventDefault();
        onToggleSources?.();
        return;
      }
      if (meta && !shift && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onToggleStudio?.();
        return;
      }
      if (meta && shift && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onFocusMode?.();
        return;
      }

      // Shortcuts without modifiers are suppressed while typing
      if (isTypingTarget(e.target) || meta || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        onFocusChat?.();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        onAddSource?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFocusChat, onAddSource, onToggleSources, onToggleStudio, onFocusMode, onEscape]);
}