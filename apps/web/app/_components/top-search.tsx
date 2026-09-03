'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The search in the top bar, and the only search input in the app.
 *
 * Typing navigates, debounced, exactly as the old in page box did: on the search
 * page it replaces `?q=` so the results render without stacking history entries;
 * anywhere else the first keystroke pushes to the search page, so Back returns
 * to where the reader came from. Submitting goes at once, without waiting for
 * the debounce.
 */

const DEBOUNCE_MS = 250;

export function TopSearch({
  searchHref,
  placeholder,
  expanded,
  onCollapse,
}: {
  /** The tenant's search page, e.g. `/u/lgu/search`. */
  searchHref: string;
  placeholder: string;
  /** Phone only: the bar has given search the whole width. */
  expanded: boolean;
  onCollapse: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onSearchPage = pathname === searchHref;

  const [value, setValue] = useState(onSearchPage ? (params.get('q') ?? '') : '');
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // The query can change under us: a soft navigation to the search page, or Back.
  useEffect(() => {
    if (onSearchPage) setValue(params.get('q') ?? '');
  }, [onSearchPage, params]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function go(raw: string, immediate: boolean): void {
    const q = raw.trim();
    const href = q ? `${searchHref}?q=${encodeURIComponent(q)}` : searchHref;
    // Replacing on the search page keeps one history entry per visit rather than
    // one per keystroke; arriving there is a real navigation.
    if (onSearchPage) router.replace(href, { scroll: false });
    else if (q || immediate) router.push(href);
  }

  function onChange(next: string): void {
    setValue(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go(next, false), DEBOUNCE_MS);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        window.clearTimeout(timer.current);
        go(value, true);
        inputRef.current?.blur();
      }}
      className="min-w-0 flex-1"
    >
      <div className="relative mx-auto w-full max-w-xl">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground"
          aria-hidden="true"
        >
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && expanded) onCollapse();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="ios-field h-9 w-full rounded-full pl-9 pr-3 text-[15px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </form>
  );
}

export function SearchIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}
