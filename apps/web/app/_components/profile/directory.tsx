'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { IdentityAvatar } from '../identity-avatar';

export type DirectoryItem = {
  id: string;
  href: string;
  title: string;
  /** Quiet second line, e.g. a building or a pending note. */
  subtitle?: string;
  /** Short figures shown under the name, already formatted. */
  meta: string;
  initials?: string;
  badge?: string;
};

/**
 * A searchable grid of people or rooms. The full list is rendered on the server
 * and filtered here in the browser, so typing is instant and costs no request.
 * The filter is a plain substring match over the title and subtitle, which is
 * what a directory of a few hundred names needs. Labels arrive as already
 * translated template strings rather than formatter functions, because a
 * function cannot cross the server/client boundary.
 */
export function Directory({
  items,
  searchLabel,
  countTemplate,
  emptyTemplate,
}: {
  items: DirectoryItem[];
  searchLabel: string;
  /** Already-translated template carrying "{count}", e.g. "12 shown". */
  countTemplate: string;
  /** Already-translated template carrying "{q}". */
  emptyTemplate: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? items.filter(
            (i) =>
              i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q),
          )
        : items,
    [items, q],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={searchLabel}
            placeholder={searchLabel}
            className="ios-field h-10 w-full rounded-xl pl-9 pr-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {countTemplate.replace('{count}', String(shown.length))}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="ios-card rounded-2xl p-8 text-center text-sm text-muted-foreground">
          {emptyTemplate.replace('{q}', query)}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                data-name={item.title}
                className="ios-card ios-pressable flex h-full items-center gap-3 rounded-2xl p-3 hover:shadow-[var(--shadow-card-strong)]"
              >
                <span aria-hidden="true">
                  <IdentityAvatar
                    seed={item.id}
                    label={item.title}
                    initials={item.initials}
                    size={40}
                    shape="circle"
                  />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{item.title}</span>
                    {item.badge ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.subtitle ? (
                    <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>
                  ) : null}
                  <span className="truncate text-xs text-muted-foreground">{item.meta}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
