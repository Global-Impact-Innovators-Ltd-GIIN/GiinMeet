# GiinMeet Public API (Phase D, 42)

A clean API so other apps can create GiinMeet meetings automatically.
Base URL: `https://giinmeet.nimdaukus.com`

## Authentication

Every request sends your API key in the `x-api-key` header. Keys are
created and revoked from the dashboard, in the Developer section. A key
looks like `giin_live_<48 hex characters>` and is shown only once, at
creation. Only a hash of the key is stored on the server, so a lost key
cannot be recovered, revoke it and create a new one.

```bash
curl -H "x-api-key: giin_live_YOUR_KEY" \
  https://giinmeet.nimdaukus.com/api/public-api/meetings
```

Keys belong to the account that created them. A key can only see and
create meetings for that account. Revoking a key takes effect immediately.

Never put an API key in client-side code, a public page, or a repository.
Treat it like a password.

## Rate limits

- Listing meetings: 60 requests per minute per IP.
- Creating meetings: 30 requests per minute per IP.

A limited request is refused with HTTP 429. Back off and retry.

## Endpoints

### List meetings

```
GET /api/public-api/meetings
```

Returns your 50 most recent meetings, newest first. Each meeting carries
a `join_url` (`https://giinmeet.nimdaukus.com/#/join?id=<id>`).

```json
{
  "ok": true,
  "meetings": [
    {
      "id": "3f2a1c00-0000-4000-8000-000000000000",
      "title": "Weekly standup",
      "time": "2026-11-30T07:00:00.000Z",
      "duration": "40m limit",
      "status": "Scheduled",
      "host": "Suku",
      "require_waiting_room": true,
      "created_at": "2026-11-23T09:00:00.000Z",
      "join_url": "https://giinmeet.nimdaukus.com/#/join?id=3f2a1c00-0000-4000-8000-000000000000"
    }
  ]
}
```

### Create a meeting

```
POST /api/public-api/meetings
Content-Type: application/json
```

Body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Up to 200 characters |
| `time` | string | yes | ISO 8601 date and time, e.g. `2026-11-30T07:00:00Z` |
| `duration` | string | no | e.g. `40m limit`. Defaults to `40m limit` |
| `require_waiting_room` | boolean | no | Defaults to `true` |
| `passcode` | string or null | no | If omitted, a passcode is generated for you. `null` means no passcode |

Response (201):

```json
{
  "ok": true,
  "meeting": {
    "id": "3f2a1c00-0000-4000-8000-000000000000",
    "title": "Weekly standup",
    "time": "2026-11-30T07:00:00.000Z",
    "duration": "40m limit",
    "status": "Scheduled",
    "host": "Suku",
    "require_waiting_room": true,
    "passcode": "482913",
    "join_url": "https://giinmeet.nimdaukus.com/#/join?id=3f2a1c00-0000-4000-8000-000000000000"
  }
}
```

The meeting is created under your account, and your plan tier decides
the room capacity (Free 50, Pro 100, Enterprise 250), exactly as in the
app. A `meeting.created` webhook fires for it when you have webhooks
configured (see below).

## Errors

Errors are JSON with a short `code` and a plain `message`:

```json
{ "ok": false, "code": "UNAUTHORIZED", "message": "An API key is required. Send it as the x-api-key header." }
```

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | A field is missing or invalid, the message says which |
| 401 | `UNAUTHORIZED` | No key, or the key is unknown or revoked |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 64 KB |
| 429 | `RATE_LIMITED` | Too many requests, slow down |
| 500 | `SERVER_MISCONFIGURED` / `DB_ERROR` | The server side is not set up, try again later |

## Webhooks

When a meeting is created, started, or ended, GiinMeet can POST a signed
event to a URL you own. Set webhooks up from the dashboard, in the
Developer section. Only HTTPS URLs are accepted.

Events:

| Event | When it fires |
|---|---|
| `meeting.created` | A meeting is created through the public API |
| `meeting.started` | The first person joins and the meeting goes live |
| `meeting.ended` | The host ends the meeting |

Each delivery is a POST with these headers:

- `Content-Type: application/json`
- `X-GiinMeet-Event: meeting.created` (or `meeting.started`, `meeting.ended`)
- `X-GiinMeet-Signature: sha256=<hex HMAC-SHA256 of the raw body>`

Verify the signature with the webhook secret shown once at creation,
using HMAC-SHA256 over the raw request body:

```js
const crypto = require('crypto');
const expected = 'sha256=' + crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
const ok = crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(req.headers['x-giinmeet-signature'] || ''),
);
```

A sample payload:

```json
{
  "event": "meeting.created",
  "meeting": {
    "id": "3f2a1c00-0000-4000-8000-000000000000",
    "title": "Weekly standup",
    "time": "2026-11-30T07:00:00.000Z",
    "host": "Suku"
  },
  "at": "2026-11-23T09:00:00.000Z"
}
```

A webhook delivery never fails the meeting action itself. If your URL
is down, the meeting still goes ahead, and the failed delivery is listed
in the Developer section with its status code, so you can see what
happened. Webhooks are delivered best effort: if your endpoint is down
for a while, an event may not arrive, so do not treat webhooks as your
only record of meetings.

## Key management

From the dashboard Developer section you can:

- Create a key (give it a name, copy the full key once, it is never
  shown again).
- Revoke a key (immediate, any app using it gets 401 from then on).
- Create a webhook (HTTPS URL, pick which events it receives).
- Delete a webhook.
- See recent webhook deliveries and their status codes.

## What the API does not do

- It cannot join a meeting, admit guests, or act as a participant.
- It cannot read other people's meetings, only the key owner's.
- It cannot change your plan or your account settings.
