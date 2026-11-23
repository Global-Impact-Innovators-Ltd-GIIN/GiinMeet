import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// POST /api/superadmin/audit { accessToken, limit?, offset? }
// Reads the superadmin audit log (newest first) plus the meeting
// deletions trail, so the portal shows one activity feed. Both
// tables are read through the service role — neither is publicly
// readable. When the SQL has not run yet, the feed reports that
// honestly instead of failing.
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-audit', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin } = checked.caller;
    const limit = Math.max(1, Math.min(100, Number(body?.limit) || 50));
    const offset = Math.max(0, Number(body?.offset) || 0);

    const { data, error } = await admin
      .from('superadmin_audit_log')
      .select('id,actor_email,action,target_type,target_id,detail,created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      const msg = String(error.message || '');
      if (/superadmin_audit_log/i.test(msg) && /relation|does not exist/i.test(msg)) {
        return NextResponse.json({
          ok: true,
          entries: [],
          deletions: [],
          notSetUp: true,
          message: 'The audit log is not set up yet — run giinmeet_superadmin.sql in the Supabase SQL Editor once, then try again.',
        });
      }
      return NextResponse.json({ error: 'DB_ERROR', message: `Could not read the audit log: ${msg}` }, { status: 500 });
    }

    let deletions: { meeting_title: string | null; deleted_at: string }[] = [];
    try {
      const { data: del } = await admin
        .from('meeting_deletions')
        .select('meeting_title,deleted_at')
        .order('deleted_at', { ascending: false })
        .limit(20);
      deletions = (del || []) as any[];
    } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
      deletions = [];
    }

    return NextResponse.json({ ok: true, entries: data || [], deletions, notSetUp: false });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin Audit] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
