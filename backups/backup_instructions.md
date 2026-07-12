# Project Backups & Database Schemas - GIIN Meet

This backup folder preserves schemas and restore instructions for the GIIN Meet database and settings profiles.

---

## 1. Supabase Database Schema Restore
To restore database structures to a new Supabase instance:
1. Access the Supabase SQL Editor.
2. Run the following backup template to generate the necessary tables:

```sql
-- Restore Script: tables scaffolding
CREATE TABLE IF NOT EXISTS public.meetings (
    id character varying(255) NOT NULL PRIMARY KEY,
    title character varying(255) NOT NULL,
    passcode character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    thread_id character varying(255) NOT NULL,
    sender_name character varying(255) NOT NULL,
    text text NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS and Realtime replication
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
```

---

## 2. Configuration Settings Backups
Vocal pitch, custom shortcuts, spatial audio switches, and accent colors are cached locally:
- Key variables are prefixed with `giin_`.
- To restore default local workspace preferences, clear the cache or run:
```javascript
localStorage.clear();
```
- Custom hotkeys reside in `giin_hotkey_mute`, `giin_hotkey_cam`, and `giin_hotkey_chat`.
