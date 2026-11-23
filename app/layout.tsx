import React from 'react';
import '../src/index.css';

export const metadata = {
  title: 'GiinMeet',
  description: 'Enterprise-grade, high-resilience video conferencing engine.',
  icons: { icon: '/favicon.ico', apple: '/icons/icon-192.png' },
  // Phase C1 (32), installable PWA: manifest + theme colour.
  manifest: '/manifest.webmanifest',
  themeColor: '#00205B',
  appleWebApp: { capable: true, title: 'GiinMeet', statusBarStyle: 'black-translucent' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#00205B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="GiinMeet" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        {/* Phase C1 (32), register the service worker for the offline
            app shell. Registration is best effort: if it fails, the app
            still works exactly as before, just without the offline shell. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); }); }`,
          }}
        />
      </head>
      <body>
        <div id="root">
          {children}
        </div>
      </body>
    </html>
  );
}
