import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_BOOTSTRAP } from '@/components/Theme';

export const metadata: Metadata = {
  title: 'Xeo Forge - Control Plane for Agentic Work',
  description: 'Run governed AI agents with approval-first execution, persistent context, reusable profiles, skills, and auditable results.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
        {/* Applies the stored theme before first paint, so there is no flash of
            the wrong theme. Must run before the body renders. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
