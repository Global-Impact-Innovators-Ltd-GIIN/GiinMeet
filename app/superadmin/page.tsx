"use client";

import dynamic from 'next/dynamic';

// The Superadmin portal lives at /superadmin — a completely separate
// entry from the user dashboard (/). SSR is disabled like the main SPA
// page: the portal reads localStorage and the browser session on mount.
const SuperadminPortal = dynamic(
  () => import('../../src/components/SuperadminPortal').then((m) => m.SuperadminPortal),
  { ssr: false }
);

export default function SuperadminPage() {
  return <SuperadminPortal />;
}
