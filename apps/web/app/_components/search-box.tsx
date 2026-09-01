'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Debounced search box: types into the URL `?q=` (soft navigation, SSR renders
 * the results). Kept fast and dependency-free.
 */
export function SearchBox({ initial, placeholder }: { initial: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  function onChange(next: string): void {
    setValue(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const q = next.trim();
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false });
    }, 250);
  }

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      autoFocus
      className="ios-field h-11 w-full max-w-xl rounded-xl px-4 text-[17px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
