"use client";

import { useEffect } from "react";

type ShortcutHandlers = {
  /** "/" — focus the chat question textarea */
  onFocusChat?: () => void;
  /** "a" — open the Add Source dialog */
  onAddSource?: () => void;
  /** Escape — close whatever overlay is currently open (citation panel,
   *  add-source dialog, mobile sources drawer), in priority order */
  onEscape?: () => void;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global notebook-page keyboard shortcuts:
 *  - "/"   focus the chat input (works from anywhere except inside a field)
 *  - "a"   open the Add Source dialog
 *  - Esc   close the topmost open overlay (fires even while typing, since
 *          that's exactly when you want to bail out of a field/dialog)
 *
 * Shortcuts other than Escape are suppressed while the user is typing in any
 * input/textarea/select/contenteditable, and when a modifier key is held, so
 * this never fights with normal typing or browser/OS shortcuts.
 */
export function useKeyboardShortcuts({ onFocusChat, onAddSource, onEscape }: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }

      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

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
  }, [onFocusChat, onAddSource, onEscape]);
}