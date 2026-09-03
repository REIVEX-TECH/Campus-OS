import type { ReactNode } from 'react';

/**
 * The center + contextual right rail of a tenant page. The rail is desktop-only
 * (xl and up) and sticky, so it never introduces an inner scrollbar; below xl,
 * and whenever a page has nothing contextual to show, the rail is omitted and the
 * content uses the full width. When the future feed module lands, its page renders
 * `center = feed`, `rail = trending` through this same component.
 */
export function PageShell({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  if (!rail) return <>{children}</>;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">{children}</div>
      <aside className="hidden xl:block" data-print-hide>
        <div className="rail-sticky flex flex-col gap-4">{rail}</div>
      </aside>
    </div>
  );
}
