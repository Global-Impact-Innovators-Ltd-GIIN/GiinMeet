import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// Phase C2a (1), the short meeting link.
//
// https://giinmeet.nimdaukus.com/s/<code> resolves the unguessable
// short code server-side to a meeting id and sends the browser to the
// normal join link (/#/join?id=<uuid>). The passcode gate and the
// waiting room still apply from there, for everyone except the host,
// exactly as with the full link. The code alone never reveals a
// passcode, and an unknown or malformed code goes to the home page.
// Static routes (/superadmin, /api/*) and the /s segment take
// precedence over the /[handle] personal-room page, and 's' is a
// reserved handle there for the same reason.
export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(code || '')) {
    redirect('/');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    redirect('/');
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin
    .from('short_links')
    .select('meeting_id')
    .eq('code', code)
    .maybeSingle();
  if (!data) {
    redirect('/');
  }
  // Best effort usage count, never blocks the redirect.
  try {
    const { data: current } = await admin
      .from('short_links')
      .select('use_count')
      .eq('code', code)
      .maybeSingle();
    await admin
      .from('short_links')
      .update({ use_count: ((current as any)?.use_count || 0) + 1, last_used_at: new Date().toISOString() })
      .eq('code', code);
  } catch (e) {
    // Usage counting is best effort only.
  }
  redirect(`/#/join?id=${(data as any).meeting_id}`);
}
