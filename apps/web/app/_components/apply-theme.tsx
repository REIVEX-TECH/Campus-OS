'use client';

import { useEffect } from 'react';

/**
 * Re-applies the resolved theme after hydration. The root layout's pre-paint
 * script sets `.dark` on <html>, but the not-found boundary re-renders <html>
 * during hydration and drops that class, so a 404 would ignore the user's theme.
 * This runs post-hydration (so it wins) and mirrors the layout script's logic.
 * Renders nothing.
 */
export function ApplyTheme() {
  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      const dark =
        stored === 'dark' ||
        (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    } catch {
      // storage unavailable (private mode); leave the pre-paint result as-is.
    }
  }, []);
  return null;
}
