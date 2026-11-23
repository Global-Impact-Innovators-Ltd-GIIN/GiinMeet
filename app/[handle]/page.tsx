import { redirect } from 'next/navigation';

// Phase C1 (25) — the pretty personal-room link.
//
// https://giinmeet.nimdaukus.com/<handle> is a short, memorable alias for
// the in-app room link (/#/room/<handle>). This page only validates the
// handle and sends the browser to the room link; the room itself is
// resolved server-side by /api/rooms/resolve and the normal join flow
// (passcode gate + waiting room for everyone except the host) takes over
// from there. Static routes (/superadmin, /api/*) take precedence over
// this dynamic segment, and reserved words are refused here.
const RESERVED = new Set(['superadmin', 'api', 'dashboard', 'join', 'room', 'login', 'signup']);

export default async function PersonalRoomHandlePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const slug = (handle || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug) || RESERVED.has(slug)) {
    redirect('/');
  }
  redirect(`/#/room/${slug}`);
}
