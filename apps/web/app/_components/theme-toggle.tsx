'use client';

/**
 * Light/dark toggle. Flips `.dark` on <html> and persists the choice; the icon is
 * driven by the `dark:` variant (the class set pre-paint by the layout script),
 * so there is no hydration state and no flash. Clearing the stored choice is not
 * exposed here; removing it would fall back to prefers-color-scheme on reload.
 */
export function ThemeToggle({ label }: { label: string }) {
  function toggle(): void {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // storage unavailable (private mode); the class still flips for this view.
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="ios-pressable ios-field grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground"
    >
      {/* Moon in light mode (tap for dark). */}
      <svg
        className="h-[18px] w-[18px] dark:hidden"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      {/* Sun in dark mode (tap for light). */}
      <svg
        className="hidden h-[18px] w-[18px] dark:block"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    </button>
  );
}
