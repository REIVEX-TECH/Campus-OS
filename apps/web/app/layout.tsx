import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// A Search Console verification token, if configured, renders the
// <meta name="google-site-verification"> tag on every page. Left unset by
// default (see docs/SEO.md and .env.example); no real token lives in the repo.
const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
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
