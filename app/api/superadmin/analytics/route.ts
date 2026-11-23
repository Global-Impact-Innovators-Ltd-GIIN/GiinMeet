// Phase D (40), usage analytics for admins. Real data only: every
// figure comes from the live meetings, participants, profiles and
// feedback tables. Anything that cannot be measured is null with a
// reason, never invented.
//
// POST /api/superadmin/analytics { accessToken }
//   -> totals, meetings per day (last 30 days), peak hours (UTC),
//      plan usage, participant minutes this month (approximate, same
//      basis as the overview route), feedback summary, open reports,
//      top hosts.
import { NextRequest } from 'next/server';
import { requireSuperadmin } from '../lib';
import {
  checkRateLimit,
  errorWithSecurity,
  internalError,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'superadmin-analytics', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin } = checked.caller;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ---- Meetings ---------------------------------------------------
    let totalMeetings = 0;
    let completedMeetings = 0;
    let liveMeetings = 0;
    let meetingsPerDay: { date: string; count: number }[] = [];
    let peakHours: { hour: number; count: number }[] = [];
    let topHosts: { host: string; meetings: number }[] = [];
    try {
      const { data, error } = await admin
        .from('meetings')
        .select('id,title,host,time,status,deleted_at')
        .gte('time', thirtyDaysAgo.toISOString())
        .order('time', { ascending: false })
        .limit(5000);
      if (!error && data) {
        const rows = (data as any[]).filter((m) => !m.deleted_at);
        totalMeetings = rows.length;
        completedMeetings = rows.filter((m) => m.status === 'Completed').length;
        liveMeetings = rows.filter((m) => m.status === 'In Progress').length;
        const perDay = new Map<string, number>();
        const perHour = new Array<number>(24).fill(0);
        const perHost = new Map<string, number>();
        for (const m of rows) {
          if (m.time) {
            const d = new Date(m.time);
            if (Number.isFinite(d.getTime())) {
              const key = d.toISOString().slice(0, 10);
              perDay.set(key, (perDay.get(key) || 0) + 1);
              perHour[d.getUTCHours()] += 1;
            }
          }
          const host = (m.host || 'Unknown').trim() || 'Unknown';
          perHost.set(host, (perHost.get(host) || 0) + 1);
        }
        meetingsPerDay = [...perDay.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));
        peakHours = perHour.map((count, hour) => ({ hour, count }));
        topHosts = [...perHost.entries()]
          .map(([host, meetings]) => ({ host, meetings }))
          .sort((a, b) => b.meetings - a.meetings)
          .slice(0, 5);
      }
    } catch (e) {
      console.error('[Superadmin Analytics] meetings read failed:', (e as any)?.message);
    }

    // ---- Plan usage --------------------------------------------------
    let planUsage: { tier: string; users: number }[] = [];
    let totalUsers = 0;
    try {
      const { data, error } = await admin
        .from('profiles')
        .select('plan_tier,is_premium')
        .limit(5000);
      if (!error && data) {
        totalUsers = data.length;
        const counts = new Map<string, number>();
        for (const p of data as any[]) {
          const tier = p.plan_tier || (p.is_premium ? 'pro' : 'free');
          counts.set(tier, (counts.get(tier) || 0) + 1);
        }
        planUsage = [...counts.entries()].map(([tier, users]) => ({ tier, users }));
      }
    } catch (e) {
      console.error('[Superadmin Analytics] profiles read failed:', (e as any)?.message);
    }

    // ---- Participant minutes this month (approximate) -----------------
    // Same basis as the overview route: participants rows carry
    // joined_at and updated_at (updated on every status change, so for
    // a LEFT row updated_at is about the left time). Still-in-room
    // rows count up to now.
    let participantMinutesThisMonth: number | null = null;
    try {
      const { data, error } = await admin
        .from('participants')
        .select('status,joined_at,updated_at')
        .gte('joined_at', monthStart)
        .limit(5000);
      if (!error && data) {
        let total = 0;
        for (const row of data as any[]) {
          const start = new Date(row.joined_at).getTime();
          const end =
            row.status === 'JOINED' ? now.getTime() : new Date(row.updated_at).getTime();
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            total += (end - start) / 60000;
          }
        }
        participantMinutesThisMonth = Math.round(total);
      }
    } catch {
      participantMinutesThisMonth = null;
    }

    // ---- Feedback ------------------------------------------------------
    let feedback: { count: number; average: number | null; distribution: number[] } | null = null;
    try {
      const { data, error } = await admin
        .from('meeting_feedback')
        .select('rating')
        .limit(5000);
      if (!error && data) {
        const rows = data as any[];
        const count = rows.length;
        feedback = {
          count,
          average:
            count > 0
              ? Math.round((rows.reduce((s, r) => s + Number(r.rating || 0), 0) / count) * 10) / 10
              : null,
          distribution: [1, 2, 3, 4, 5].map(
            (stars) => rows.filter((r) => Number(r.rating) === stars).length,
          ),
        };
      } else {
        feedback = null;
      }
    } catch {
      feedback = null;
    }

    // ---- Open reports ---------------------------------------------------
    let openReports = 0;
    let reportsAvailable = false;
    try {
      const { count, error } = await admin
        .from('meeting_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open');
      if (!error) {
        openReports = count ?? 0;
        reportsAvailable = true;
      }
    } catch {
      reportsAvailable = false;
    }

    return jsonWithSecurity({
      ok: true,
      analytics: {
        totalMeetings,
        completedMeetings,
        liveMeetings,
        totalUsers,
        meetingsPerDay,
        peakHours,
        planUsage,
        participantMinutesThisMonth,
        feedback,
        openReports,
        reportsAvailable,
        topHosts,
        generatedAt: now.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Superadmin Analytics API', err);
  }
}
