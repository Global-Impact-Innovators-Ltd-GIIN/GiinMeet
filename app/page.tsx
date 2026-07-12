"use client";

import dynamic from 'next/dynamic';

// Disable SSR for the main SPA page to prevent hydration mismatches on browser APIs (localStorage, navigator, window)
const App = dynamic(() => import('../src/App'), {
  ssr: false,
});

export default function Home() {
  return <App />;
}
