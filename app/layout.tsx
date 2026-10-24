import type { Metadata } from 'next'
import Script from 'next/script'
import { siteJsonLd, SITE_DESCRIPTION, SITE_URL } from '@/lib/seo'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'LocReport — The pulse of the language services industry',
    // Guarantees the brand token is present in every page title, so no future
    // page can ship brandless. Pages set only their own part of the title.
    template: '%s — LocReport',
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  applicationName: 'LocReport',
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
  openGraph: {
    images: [{ url: '/og-image.jpg', width: 1200, height: 630 }],
  },
  alternates: {
    types: {
      'application/rss+xml': [{ url: '/feed.xml', title: 'LocReport — All articles' }],
    },
  },
}

// Runs before first paint so the persisted (or OS-preferred) theme applies
// without a flash of the light theme.
const themeInitScript = `
try {
  var t = localStorage.getItem('theme');
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Fetch fonts in the browser so Google font URL changes cannot break builds. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>
      <body>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-1KQKEEP1PL"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-1KQKEEP1PL');
          `}
        </Script>
        {children}
      </body>
    </html>
  )
}
