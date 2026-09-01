/**
 * "Skip to content" link: the first focusable element on the page, visually
 * hidden until focused, then jumping keyboard and screen-reader users past the
 * header nav to `#main`. Pair with `id="main"` on the page's <main>.
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-background px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-card)] focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-3 focus-visible:z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </a>
  );
}
