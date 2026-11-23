// Phase C1 (23) — calendar sync, server side only.
//
// Google Calendar + Microsoft Outlook (Graph), OAuth 2.0 with offline
// access (refresh tokens), two-way:
//   * Push: a GiinMeet meeting is created/updated/deleted on every
//     connected calendar (event carries the GiinMeet meeting id, so the
//     two sides can be matched again later).
//   * Pull: upcoming provider events are listed with their matched
//     GiinMeet meeting id, so a time change made in Google/Outlook can be
//     applied back to GiinMeet.
//
// Security:
//   * OAuth client IDs/secrets come from env vars only, never hardcoded,
//     never committed, never sent to a browser.
//   * The OAuth `state` is an HMAC-signed, expiring token (secret from
//     GIINMEET_OAUTH_STATE_SECRET) that binds the callback to the user
//     who started the connect, so a callback cannot be replayed for
//     another account.
//   * Provider tokens live in calendar_connections (service role only,
//     no client policies) and are NEVER returned to a browser. When
//     GIINMEET_TOKEN_ENCRYPTION_KEY is set they are AES-256-GCM encrypted
//     before storage; without it they are stored as issued and the
//     status route says so plainly.
//   * All provider calls are server-to-server with short timeouts and
//     capped response sizes; failures are short plain-words reasons.
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type CalendarProvider = 'google' | 'outlook';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const OUTLOOK_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const OUTLOOK_SCOPE = 'Calendars.ReadWrite offline_access';

export function calendarProviderConfigured(provider: CalendarProvider): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
  }
  return Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET);
}

export function calendarRedirectUri(provider: CalendarProvider, origin: string): string {
  return `${origin}/api/calendar/callback?provider=${provider}`;
}

// ---------------------------------------------------------------------------
// OAuth state: HMAC-signed, 10-minute, binds the callback to one user.
// ---------------------------------------------------------------------------
let ephemeralStateSecret: string | null = null;

function stateSecret(): string {
  if (process.env.GIINMEET_OAUTH_STATE_SECRET) return process.env.GIINMEET_OAUTH_STATE_SECRET;
  // No configured secret: a random per-instance secret. Connect still
  // works on a single server instance; Vercel needs the env var set for
  // production (see docs/PHASE_C1_SETUP.md).
  if (!ephemeralStateSecret) ephemeralStateSecret = randomBytes(32).toString('hex');
  return ephemeralStateSecret;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function signCalendarState(userId: string, provider: CalendarProvider): string {
  const payload = JSON.stringify({
    u: userId,
    p: provider,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const body = b64url(payload);
  const sig = b64url(createHmac('sha256', stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyCalendarState(
  state: string,
): { userId: string; provider: CalendarProvider } | null {
  try {
    const [body, sig] = String(state || '').split('.');
    if (!body || !sig) return null;
    const expected = b64url(createHmac('sha256', stateSecret()).update(body).digest());
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      u?: string;
      p?: string;
      exp?: number;
    };
    if (!payload.u || (payload.p !== 'google' && payload.p !== 'outlook')) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return { userId: payload.u, provider: payload.p };
  } catch {
    return null;
  }
}

export function buildCalendarAuthUrl(
  provider: CalendarProvider,
  origin: string,
  state: string,
): string | null {
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      redirect_uri: calendarRedirectUri(provider, origin),
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: process.env.OUTLOOK_CLIENT_ID || '',
    redirect_uri: calendarRedirectUri(provider, origin),
    response_type: 'code',
    scope: OUTLOOK_SCOPE,
    state,
  });
  return `${OUTLOOK_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token storage encryption (AES-256-GCM, key from env, base64 32 bytes).
// ---------------------------------------------------------------------------
function encryptionKey(): Buffer | null {
  const raw = process.env.GIINMEET_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function tokensEncryptionEnabled(): boolean {
  return encryptionKey() !== null;
}

export function encryptToken(plain: string): string {
  const key = encryptionKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc1:${b64url(JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') }))}`;
}

export function decryptToken(stored: string | null): string | null {
  if (!stored) return null;
  if (!stored.startsWith('enc1:')) return stored;
  const key = encryptionKey();
  if (!key) return null;
  try {
    const { iv, tag, data } = JSON.parse(
      Buffer.from(stored.slice(5), 'base64url').toString('utf8'),
    ) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider token exchange / refresh.
// ---------------------------------------------------------------------------
export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

async function postForm(url: string, params: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`provider_${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCalendarCode(
  provider: CalendarProvider,
  code: string,
  origin: string,
): Promise<ProviderTokens> {
  if (provider === 'google') {
    const data = await postForm(GOOGLE_TOKEN_URL, {
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
      redirect_uri: calendarRedirectUri(provider, origin),
      grant_type: 'authorization_code',
    });
    return {
      accessToken: String(data.access_token || ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    };
  }
  const data = await postForm(OUTLOOK_TOKEN_URL, {
    code,
    client_id: process.env.OUTLOOK_CLIENT_ID || '',
    client_secret: process.env.OUTLOOK_CLIENT_SECRET || '',
    redirect_uri: calendarRedirectUri(provider, origin),
    grant_type: 'authorization_code',
    scope: OUTLOOK_SCOPE,
  });
  return {
    accessToken: String(data.access_token || ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
  };
}

async function refreshProviderToken(
  provider: CalendarProvider,
  refreshToken: string,
): Promise<ProviderTokens> {
  if (provider === 'google') {
    const data = await postForm(GOOGLE_TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    });
    return {
      accessToken: String(data.access_token || ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
    };
  }
  const data = await postForm(OUTLOOK_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: process.env.OUTLOOK_CLIENT_ID || '',
    client_secret: process.env.OUTLOOK_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
    scope: OUTLOOK_SCOPE,
  });
  return {
    accessToken: String(data.access_token || ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
  };
}

// ---------------------------------------------------------------------------
// Stored connections.
// ---------------------------------------------------------------------------
export interface CalendarConnectionRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  calendar_id: string | null;
  account_email: string | null;
}

export async function getCalendarConnection(
  admin: any,
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarConnectionRow | null> {
  const { data } = await admin
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  return (data as CalendarConnectionRow | null) || null;
}

export async function listCalendarConnections(
  admin: any,
  userId: string,
): Promise<CalendarConnectionRow[]> {
  const { data } = await admin
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId);
  return (data || []) as CalendarConnectionRow[];
}

/** A usable access token for this connection, refreshing it first when it
 *  is expired or about to expire. Returns null when there is no usable
 *  token (the user must reconnect). */
export async function getUsableAccessToken(
  admin: any,
  connection: CalendarConnectionRow,
): Promise<string | null> {
  const current = decryptToken(connection.access_token);
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  if (current && expiresAt > Date.now() + 60 * 1000) return current;
  const refreshToken = decryptToken(connection.refresh_token);
  if (!refreshToken) return current;
  try {
    const fresh = await refreshProviderToken(connection.provider, refreshToken);
    if (!fresh.accessToken) return current;
    const nextExpires = fresh.expiresIn
      ? new Date(Date.now() + fresh.expiresIn * 1000).toISOString()
      : connection.token_expires_at;
    await admin
      .from('calendar_connections')
      .update({
        access_token: encryptToken(fresh.accessToken),
        refresh_token: fresh.refreshToken
          ? encryptToken(fresh.refreshToken)
          : connection.refresh_token,
        token_expires_at: nextExpires,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);
    return fresh.accessToken;
  } catch {
    return current;
  }
}

export async function upsertCalendarConnection(
  admin: any,
  userId: string,
  provider: CalendarProvider,
  tokens: ProviderTokens,
  accountEmail: string | null,
): Promise<void> {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    : null;
  const existing = await getCalendarConnection(admin, userId, provider);
  const row = {
    access_token: encryptToken(tokens.accessToken),
    refresh_token: tokens.refreshToken ? encryptToken(tokens.refreshToken) : existing?.refresh_token || null,
    token_expires_at: expiresAt,
    scope: provider === 'google' ? GOOGLE_CALENDAR_SCOPE : OUTLOOK_SCOPE,
    account_email: accountEmail,
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await admin.from('calendar_connections').update(row).eq('id', existing.id);
  } else {
    await admin.from('calendar_connections').insert([
      { user_id: userId, provider, ...row },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Provider API calls (short timeouts, capped bodies).
// ---------------------------------------------------------------------------
async function providerFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new Error(`provider_${res.status}`);
    return text ? JSON.parse(text.slice(0, 2_000_000)) : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAccountEmail(
  provider: CalendarProvider,
  accessToken: string,
): Promise<string | null> {
  try {
    if (provider === 'google') {
      const data = await providerFetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary',
        accessToken,
      );
      return typeof data?.id === 'string' ? data.id : null;
    }
    const data = await providerFetch('https://graph.microsoft.com/v1.0/me', accessToken);
    return (
      (typeof data?.mail === 'string' && data.mail) ||
      (typeof data?.userPrincipalName === 'string' ? data.userPrincipalName : null)
    );
  } catch {
    return null;
  }
}

export interface CalendarEventInput {
  title: string;
  startIso: string;
  endIso: string;
  description: string;
  meetingId: string;
  joinUrl: string;
}

export async function createProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  event: CalendarEventInput,
): Promise<string | null> {
  if (provider === 'google') {
    const data = await providerFetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          summary: event.title,
          description: `${event.description}\n\nJoin: ${event.joinUrl}\nGiinMeet meeting: ${event.meetingId}`,
          start: { dateTime: event.startIso },
          end: { dateTime: event.endIso },
          extendedProperties: { private: { giinmeet_meeting_id: event.meetingId } },
        }),
      },
    );
    return typeof data?.id === 'string' ? data.id : null;
  }
  const data = await providerFetch('https://graph.microsoft.com/v1.0/me/events', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      subject: event.title,
      body: {
        contentType: 'text',
        content: `${event.description}\n\nJoin: ${event.joinUrl}\nGiinMeet meeting: ${event.meetingId}`,
      },
      start: { dateTime: event.startIso, timeZone: 'UTC' },
      end: { dateTime: event.endIso, timeZone: 'UTC' },
    }),
  });
  return typeof data?.id === 'string' ? data.id : null;
}

export async function updateProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  eventId: string,
  event: CalendarEventInput,
): Promise<boolean> {
  try {
    if (provider === 'google') {
      await providerFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        accessToken,
        {
          method: 'PATCH',
          body: JSON.stringify({
            summary: event.title,
            description: `${event.description}\n\nJoin: ${event.joinUrl}\nGiinMeet meeting: ${event.meetingId}`,
            start: { dateTime: event.startIso },
            end: { dateTime: event.endIso },
          }),
        },
      );
      return true;
    }
    await providerFetch(
      `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          subject: event.title,
          body: {
            contentType: 'text',
            content: `${event.description}\n\nJoin: ${event.joinUrl}\nGiinMeet meeting: ${event.meetingId}`,
          },
          start: { dateTime: event.startIso, timeZone: 'UTC' },
          end: { dateTime: event.endIso, timeZone: 'UTC' },
        }),
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  eventId: string,
): Promise<void> {
  try {
    if (provider === 'google') {
      await providerFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        accessToken,
        { method: 'DELETE' },
      );
    } else {
      await providerFetch(
        `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`,
        accessToken,
        { method: 'DELETE' },
      );
    }
  } catch {
    // Best effort: a deleted provider event is not worth failing the sync.
  }
}

export interface PulledCalendarEvent {
  provider: CalendarProvider;
  eventId: string;
  title: string;
  start: string;
  end: string;
  meetingId: string | null;
}

export async function listProviderEvents(
  provider: CalendarProvider,
  accessToken: string,
  fromIso: string,
  toIso: string,
): Promise<PulledCalendarEvent[]> {
  try {
    if (provider === 'google') {
      const params = new URLSearchParams({
        timeMin: fromIso,
        timeMax: toIso,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '100',
      });
      const data = await providerFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
        accessToken,
      );
      return ((data?.items || []) as any[]).map((item) => ({
        provider,
        eventId: String(item.id || ''),
        title: String(item.summary || 'Untitled event'),
        start: String(item.start?.dateTime || item.start?.date || ''),
        end: String(item.end?.dateTime || item.end?.date || ''),
        meetingId:
          (item.extendedProperties?.private?.giinmeet_meeting_id as string) || null,
      }));
    }
    const params = new URLSearchParams({
      startDateTime: fromIso,
      endDateTime: toIso,
      $top: '100',
      $orderby: 'start/dateTime',
    });
    const data = await providerFetch(
      `https://graph.microsoft.com/v1.0/me/calendarview?${params.toString()}`,
      accessToken,
    );
    return ((data?.value || []) as any[]).map((item) => {
      const body = String(item.body?.content || '');
      const match = body.match(/GiinMeet meeting:\s*([0-9a-f-]{36})/i);
      return {
        provider,
        eventId: String(item.id || ''),
        title: String(item.subject || 'Untitled event'),
        start: String(item.start?.dateTime || ''),
        end: String(item.end?.dateTime || ''),
        meetingId: match ? match[1] : null,
      };
    });
  } catch {
    return [];
  }
}

export interface BusyWindow {
  start: string;
  end: string;
}

/** Busy windows for free/busy checks (feature 33). Empty when the
 *  provider cannot answer, so scheduling falls back to stated
 *  availability instead of failing. */
export async function listBusyWindows(
  provider: CalendarProvider,
  accessToken: string,
  fromIso: string,
  toIso: string,
): Promise<BusyWindow[]> {
  try {
    if (provider === 'google') {
      const data = await providerFetch(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            timeMin: fromIso,
            timeMax: toIso,
            items: [{ id: 'primary' }],
          }),
        },
      );
      const busy = (data?.calendars?.primary?.busy || []) as any[];
      return busy.map((b) => ({ start: String(b.start), end: String(b.end) }));
    }
    const data = await providerFetch(
      'https://graph.microsoft.com/v1.0/me/calendar/getSchedule',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          schedules: ['me'],
          startTime: { dateTime: fromIso, timeZone: 'UTC' },
          endTime: { dateTime: toIso, timeZone: 'UTC' },
          availabilityViewInterval: 30,
        }),
      },
    );
    const items = (data?.value?.[0]?.scheduleItems || []) as any[];
    return items
      .filter((i) => i.status === 'busy' || i.status === 'tentative' || i.status === 'oof')
      .map((i) => ({
        start: String(i.start?.dateTime || ''),
        end: String(i.end?.dateTime || ''),
      }))
      .filter((w) => w.start && w.end);
  } catch {
    return [];
  }
}
