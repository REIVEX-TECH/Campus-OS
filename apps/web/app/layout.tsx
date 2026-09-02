import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { baseUrlFromHost } from '@/lib/tenant';
import './globals.css';

// The mobile browser chrome colour, matched to each theme's page background.
// (This tracks the OS scheme; a manual toggle override is a minor, accepted
// mismatch limited to the browser UI bar.)
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

// A Search Console verification token, if configured, renders the
// <meta name="google-site-verification"> tag on every page. Left unset by
// default (see docs/SEO.md and .env.example); no real token lives in the repo.
const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION;

/**
 * The absolute origin social cards resolve against. Statically rendered routes
 * (the 404, the platform opengraph image) have no request host to read, so the
 * base has to come from configuration; without it Next falls back to
 * http://localhost:3000 and shared links preview a dead image. Tenant pages
 * override this per request with their own host in `pageMetadata`.
 */
const PLATFORM_ORIGIN = baseUrlFromHost(
  process.env.PLATFORM_HOST ||
    process.env.TENANT_BASE_DOMAIN ||
    process.env.APP_DOMAIN ||
    'localhost:3000',
);

export const metadata: Metadata = {
  metadataBase: new URL(PLATFORM_ORIGIN),
  title: 'CampusOS',
  description: 'An open-source, multi-tenant campus platform.',
  ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
};

// Resolve the theme before first paint (no flash): a stored choice wins, else the
// OS prefers-color-scheme. Toggling `.dark` on <html> switches the token palette.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('theme');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
