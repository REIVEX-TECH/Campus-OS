import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The quiet line above a profile name: where this page sits, and how fresh the
 * data is.
 *
 * The two stack on a phone and sit side by side from `sm`. Inline text with a
 * separator wrapped badly on a narrow screen, leaving the middot dangling at the
 * end of a line, so the separator only exists when the two are actually on one
 * line.
 */
export function ProfileBreadcrumb({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
      <Link href={href} className="text-primary hover:underline">
        {label}
      </Link>
      {children ? (
        <>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          {children}
        </>
      ) : null}
    </div>
  );
}
