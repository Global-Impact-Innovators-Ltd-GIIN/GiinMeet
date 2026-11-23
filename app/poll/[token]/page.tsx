// Phase C1 (33), public scheduling poll page (no account needed).
// Reads the poll and its votes server-side with the service role and
// renders a plain, branded page. Votes post to
// /api/scheduling/respond, which redirects back here with ?voted=1.
import { getAdminClient } from '../../api/_lib/security';

export const dynamic = 'force-dynamic';

const NAVY = '#00205B';
const GOLD = '#FABD02';

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function PollPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ voted?: string }>;
}) {
  const { token } = await params;
  const { voted } = await searchParams;
  const admin = getAdminClient();
  let poll: any = null;
  let votes: any[] = [];
  if (admin && /^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    const { data } = await admin
      .from('scheduling_polls')
      .select('id, title, duration_minutes, slots, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      poll = data;
      const { data: v } = await admin
        .from('scheduling_poll_votes')
        .select('voter_name, votes')
        .eq('poll_id', data.id)
        .order('created_at', { ascending: true });
      votes = v || [];
    }
  }
  const slots: string[] = poll?.slots || [];
  const tallies: Record<string, { yes: number; maybe: number; no: number }> = {};
  for (const s of slots) tallies[s] = { yes: 0, maybe: 0, no: 0 };
  for (const v of votes) {
    for (const [slot, answer] of Object.entries((v.votes || {}) as Record<string, string>)) {
      if (tallies[slot] && (answer === 'yes' || answer === 'maybe' || answer === 'no')) {
        tallies[slot][answer] += 1;
      }
    }
  }
  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#F4F6FB', minHeight: '100dvh', color: '#0F1B33' }}>
      <div style={{ background: NAVY, color: '#fff', borderRadius: '16px', padding: '20px 24px', marginBottom: '16px' }}>
        <div style={{ fontSize: '20px', fontWeight: 800 }}>GiinMeet</div>
        <div style={{ fontSize: '13px', opacity: 0.85, marginTop: '4px' }}>Pick a time that works for you</div>
      </div>
      {!poll ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '18px', margin: '0 0 8px' }}>This poll is not available</h1>
          <p style={{ color: '#667085', fontSize: '14px', margin: 0 }}>
            The link may be wrong, or the poll may have expired. Ask the host for a fresh link.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '24px' }}>
          <h1 style={{ fontSize: '18px', margin: '0 0 4px' }}>{poll.title}</h1>
          <p style={{ color: '#667085', fontSize: '14px', margin: '0 0 16px' }}>
            {poll.duration_minutes} minutes. Pick what works for each time, then send your vote.
          </p>
          {voted && (
            <p style={{ background: '#EAF7EE', border: '1px solid #A9DDB8', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', margin: '0 0 16px' }}>
              Thank you, your vote was saved.
            </p>
          )}
          <form method="post" action="/api/scheduling/respond">
            <input type="hidden" name="token" value={token} />
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
              Your name
            </label>
            <input
              type="text"
              name="voterName"
              required
              maxLength={80}
              placeholder="Your name"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #D0D7E6', borderRadius: '10px', fontSize: '14px', marginBottom: '16px' }}
            />
            {slots.map((s) => {
              const t = tallies[s];
              return (
                <div key={s} style={{ border: '1px solid #E5E9F2', borderRadius: '12px', padding: '12px 14px', marginBottom: '10px' }}>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{fmt(s)}</div>
                  <div style={{ fontSize: '13px', color: '#667085', margin: '6px 0 10px' }}>
                    {t.yes} can make it, {t.maybe} maybe, {t.no} cannot
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(['yes', 'maybe', 'no'] as const).map((a) => (
                      <label key={a} style={{ fontSize: '13px', border: '1px solid #D0D7E6', borderRadius: '999px', padding: '6px 12px', cursor: 'pointer' }}>
                        <input type="radio" name={`vote:${s}`} value={a} defaultChecked={a === 'yes'} style={{ marginRight: '4px' }} />
                        {a === 'yes' ? 'Works' : a === 'maybe' ? 'Maybe' : 'No'}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            <button
              type="submit"
              style={{ width: '100%', marginTop: '8px', background: GOLD, color: NAVY, border: 'none', borderRadius: '999px', padding: '12px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}
            >
              Send my vote
            </button>
          </form>
          {votes.length > 0 && (
            <div style={{ marginTop: '20px', borderTop: '1px solid #E5E9F2', paddingTop: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>
                Voted so far ({votes.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {votes.map((v, i) => (
                  <li key={i} style={{ fontSize: '13px', color: '#344054' }}>{v.voter_name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: '12px', color: '#667085', textAlign: 'center', marginTop: '24px' }}>
        GiinMeet by Global Impact Innovators Ltd
      </p>
    </div>
  );
}
