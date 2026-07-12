import React from 'react';
import '../src/index.css';

export const metadata = {
  title: 'GIIN Meet - Virtualization & Collaboration Hub',
  description: 'Enterprise-grade, high-resilience video conferencing engine.',
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
      </head>
      <body>
        <div id="root">
          {children}
        </div>
      </body>
    </html>
  );
}
