import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The admin area is not for search engines: the login is publicly reachable (it
// is the entry point) but should never be indexed, and neither should anything
// behind it. `noindex, nofollow` covers every admin route. The sitemap already
// omits these pages; this stops a crawler that finds the URL from indexing it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
