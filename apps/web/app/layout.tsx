import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CampusOS',
  description: 'An open-source, multi-tenant campus platform.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Force the light theme platform-wide (the design language is iOS light). The
  // `light` class opts out of the prefers-color-scheme dark fallback in
  // globals.css, so a dark-OS visitor still gets the intended light UI.
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
