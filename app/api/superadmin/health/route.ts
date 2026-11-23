// Phase D (43), health monitoring and alerts. No paid service: the
// app probes its own dependencies and tells the superadmin.
//
// POST /api/superadmin/health { accessToken, action: 'check' | 'list' }
//   check: probes Supabase (a real read), LiveKit (listRooms) and the
//     site itself (fetches the site root). Each result is stored in
//     health_checks. When a service flips from up to down, one open
//     health_alert is created and the superadmin is emailed once
//     (GIIN Meet <noreply@mail.nimdaukus.com>, via Resend when it is
//     configured; when it is not, the alert still exists in the portal
//     and the email is honestly reported as not sent). When a service
//     recovers, its open alerts are resolved.
//   list: the latest check per service, the last 20 checks, and open
//     alerts. No probing, safe to call on every portal visit.
import { NextRequest } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { requireSuperadmin } from '../lib';
import { superadminEmail } from '../../_lib/phaseD';
import { sendMail } from '../../../../src/utils/mailer';
import {
  checkRateLimit,
  errorWithSecurity,
  internalError,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

type ServiceStatus = 'up' | 'down' | 'not-configured';

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out.')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeSupabase(admin: any): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const { error } = await admin.from('profiles').select('id').limit(1);
    if (error) return { status: 'down', detail: 'Supabase read failed: ' + String(error.message || error).slice(0, 160) };
    return { status: 'up', detail: 'Supabase answered a live read.' };
  } catch (e: any) {
    return { status: 'down', detail: 'Supabase read failed: ' + String(e?.message || e).slice(0, 160) };
  }
}

async function probeLiveKit(): Promise<{ status: ServiceStatus; detail: string }> {
  const lkUrl = process.env.LIVEKIT_URL;
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;
  if (!lkUrl || !lkKey || !lkSecret) {
    return { status: 'not-configured', detail: 'LiveKit is not configured on this server (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing).' };
  }
  try {
    const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
    const rooms = await withTimeout(roomService.listRooms(), 5000);
    return { status: 'up', detail: `LiveKit answered, ${(rooms || []).length} room(s) live now.` };
  } catch (e: any) {
    return { status: 'down', detail: 'LiveKit did not answer: ' + String(e?.message || e).slice(0, 160) };
  }
}

async function probeSite(req: NextRequest): Promise<{ status: ServiceStatus; detail: string }> {
  const origin = req.nextUrl.origin;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(origin + '/', { signal: controller.signal, redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) {
        return { status: 'up', detail: `The site answered ${origin} with HTTP ${res.status}.` };
      }
      return { status: 'down', detail: `The site answered ${origin} with HTTP ${res.status}.` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    return { status: 'down', detail: 'The site did not answer: ' + String(e?.message || e).slice(0, 160) };
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'superadmin-health', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin } = checked.caller;
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      let checks: any[] = [];
      let alerts: any[] = [];
      let available = false;
      try {
        const { data, error } = await admin
          .from('health_checks')
          .select('service,status,detail,checked_at')
          .order('checked_at', { ascending: false })
          .limit(20);
        if (!error) {
          checks = data || [];
          available = true;
        }
        const { data: alertRows } = await admin
          .from('health_alerts')
          .select('id,service,status,message,notified,created_at,resolved_at')
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(20);
        alerts = alertRows || [];
      } catch {
        available = false;
      }
      return jsonWithSecurity({
        ok: true,
        available,
        checks,
        alerts,
        message: available
          ? undefined
          : 'Health monitoring needs the Phase D database setup first (run giinmeet_phaseD.sql).',
      });
    }

    if (action !== 'check') {
      return errorWithSecurity('BAD_REQUEST', 'Unknown health action.', 400);
    }

    // ---- run the three probes --------------------------------------
    const results: { service: string; status: ServiceStatus; detail: string }[] = [
      { service: 'supabase', ...(await probeSupabase(admin)) },
      { service: 'livekit', ...(await probeLiveKit()) },
      { service: 'site', ...(await probeSite(req)) },
    ];
    const nowIso = new Date().toISOString();

    // ---- store, compare with the last check, alert on a new down ----
    const emailTo = await superadminEmail(admin);
    const alertsCreated: { service: string; emailed: boolean }[] = [];
    for (const result of results) {
      try {
        await admin.from('health_checks').insert({
          service: result.service,
          status: result.status,
          detail: result.detail,
          checked_at: nowIso,
        });
      } catch {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Health monitoring needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      if (result.status !== 'down') {
        // Recovered: resolve any open alerts for this service.
        try {
          await admin
            .from('health_alerts')
            .update({ resolved_at: nowIso })
            .eq('service', result.service)
            .is('resolved_at', null);
        } catch { /* resolving is best-effort */ }
        continue;
      }
      // Down: alert only when the previous check was not already down,
      // so a long outage sends one alert, not one per check.
      let wasAlreadyDown = false;
      try {
        const { data: last } = await admin
          .from('health_checks')
          .select('status')
          .eq('service', result.service)
          .order('checked_at', { ascending: false })
          .limit(2);
        const rows = (last || []) as any[];
        // rows[0] is the row just inserted; rows[1] is the previous.
        wasAlreadyDown = rows.length > 1 && rows[1].status === 'down';
      } catch { wasAlreadyDown = false; }
      if (wasAlreadyDown) continue;
      const message = `GiinMeet health alert: ${result.service} is down. ${result.detail}`;
      let emailed = false;
      try {
        const sent = await sendMail(
          emailTo,
          `GiinMeet alert: ${result.service} is down`,
          message + '\n\nCheck the superadmin portal, Monitoring section, for the latest status.',
        );
        emailed = sent.ok;
        if (!sent.ok) {
          console.error('[Superadmin Health] Alert email not sent:', sent.reason);
        }
      } catch (e: any) {
        console.error('[Superadmin Health] Alert email failed:', e?.message || e);
      }
      try {
        await admin.from('health_alerts').insert({
          service: result.service,
          status: 'down',
          message,
          notified: emailed,
        });
      } catch { /* the portal still shows the failed check */ }
      alertsCreated.push({ service: result.service, emailed });
    }

    return jsonWithSecurity({ ok: true, results, alertsCreated, checkedAt: nowIso });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Superadmin Health API', err);
  }
}
