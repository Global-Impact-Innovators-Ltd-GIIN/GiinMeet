// Phase C1 (28), library search.
//
// GET ?q=...&accessToken=..., searches the caller's own meetings only:
// transcripts, summaries, notes and registered files. The search runs
// server-side over the caller's meetings (hosted, or admitted to), so
// one user can never search another user's meeting records. Results are
// capped at 20, with a short snippet each. Rate limited.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  jsonWithSecurity,
} from '../../_lib/security';

interface SearchHit {
  meetingId: string;
  meetingTitle: string;
  kind: 'transcript' | 'summary' | 'note' | 'file';
  snippet: string;
}

function snippetFor(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 140);
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + query.length + 90);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-search', 30, 60 * 1000);
    if (limited) return limited;
    const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 200);
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (q.length < 2) {
      return jsonWithSecurity({ ok: true, results: [] });
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to search your library.', 401);
    }
    // The caller's meetings: hosted, or admitted to as a participant.
    const { data: hosted } = await admin
      .from('meetings')
      .select('id, title')
      .or(`user_id.eq.${user.id},admin_id.eq.${user.id}`);
    const { data: participations } = await admin
      .from('meeting_participants')
      .select('meeting_id')
      .eq('user_id', user.id)
      .eq('status', 'Admitted');
    const titles = new Map<string, string>();
    (hosted || []).forEach((m: any) => titles.set(m.id, m.title || 'Untitled meeting'));
    const ids = new Set<string>([...titles.keys()]);
    for (const p of participations || []) {
      if ((p as any).meeting_id) ids.add((p as any).meeting_id);
    }
    if (ids.size === 0) return jsonWithSecurity({ ok: true, results: [] });
    const idList = [...ids];
    // Any missing titles (admitted meetings) come from one more read.
    const missing = idList.filter((id) => !titles.has(id));
    if (missing.length > 0) {
      const { data: more } = await admin
        .from('meetings')
        .select('id, title')
        .in('id', missing);
      (more || []).forEach((m: any) => titles.set(m.id, m.title || 'Untitled meeting'));
    }
    const needle = q.toLowerCase();
    const hits: SearchHit[] = [];
    const push = (meetingId: string, kind: SearchHit['kind'], text: string) => {
      if (hits.length >= 20) return;
      if (!text || !text.toLowerCase().includes(needle)) return;
      hits.push({
        meetingId,
        meetingTitle: titles.get(meetingId) || 'Untitled meeting',
        kind,
        snippet: snippetFor(text, q),
      });
    };
    const { data: transcripts } = await admin
      .from('meeting_transcripts')
      .select('meeting_id, lines')
      .in('meeting_id', idList)
      .limit(200);
    for (const t of transcripts || []) {
      const lines = ((t as any).lines || []) as { name: string; text: string }[];
      const text = lines.map((l) => `${l.name}: ${l.text}`).join('\n');
      push((t as any).meeting_id, 'transcript', text);
    }
    const { data: summaries } = await admin
      .from('meeting_summaries')
      .select('meeting_id, summary, decisions, action_items')
      .in('meeting_id', idList)
      .limit(200);
    for (const s of summaries || []) {
      const text = [
        (s as any).summary || '',
        ...(((s as any).decisions || []) as string[]),
        ...(((s as any).action_items || []) as any[]).map((a: any) => a.text || ''),
      ].join('\n');
      push((s as any).meeting_id, 'summary', text);
    }
    const { data: notes } = await admin
      .from('meeting_notes')
      .select('meeting_id, body')
      .in('meeting_id', idList)
      .limit(200);
    for (const n of notes || []) {
      push((n as any).meeting_id, 'note', (n as any).body || '');
    }
    const { data: files } = await admin
      .from('meeting_files')
      .select('meeting_id, name, note')
      .in('meeting_id', idList)
      .limit(200);
    for (const f of files || []) {
      push((f as any).meeting_id, 'file', `${(f as any).name || ''} ${(f as any).note || ''}`);
    }
    return jsonWithSecurity({ ok: true, results: hits });
  } catch (err) {
    return internalError('Library Search API', err);
  }
}
