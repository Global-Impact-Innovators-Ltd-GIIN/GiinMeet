-- -------------------------------------------------------------
-- GIIN MEET SUPABASE SQL SCHEMA SETUP
-- Run this in your Supabase SQL Editor (https://supabase.com)
-- -------------------------------------------------------------

-- 1. PROFILES TABLE (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  workspace_name TEXT DEFAULT 'Personal Workspace',
  domain TEXT DEFAULT 'personal',
  phone TEXT,
  is_premium BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to profiles (workspace directory discovery)"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Allow individual write access to own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow individual insert access to own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);


-- 2. MEETINGS TABLE
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration TEXT,
  status TEXT CHECK (status IN ('Completed', 'In Progress', 'Scheduled')) DEFAULT 'Scheduled',
  host TEXT,
  notes TEXT,
  action_items_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on Meetings
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow individual read access to own meetings"
  ON public.meetings FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow individual insert access to own meetings"
  ON public.meetings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow individual update access to own meetings"
  ON public.meetings FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Allow individual delete access to own meetings"
  ON public.meetings FOR DELETE USING (auth.uid() = user_id);


-- 3. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS on Messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- For demo simplicity, we allow all authenticated users to read and send messages in active channels
CREATE POLICY "Allow authenticated read access to messages"
  ON public.messages FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated write access to messages"
  ON public.messages FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- 4. PROFILE SYNCHRONIZATION TRIGGER
-- Trigger function to automatically create a public profile record when a new user signs up in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  parsed_domain TEXT;
  parsed_workspace TEXT;
  full_name TEXT;
  phone_num TEXT;
BEGIN
  -- Extract domain from email (if present)
  IF NEW.email IS NOT NULL AND NEW.email LIKE '%@%' THEN
    parsed_domain := split_part(NEW.email, '@', 2);
  ELSE
    parsed_domain := 'personal';
  END IF;

  -- Default workspace configurations
  IF parsed_domain = 'gmail.com' OR parsed_domain = 'yahoo.com' OR parsed_domain = 'hotmail.com' OR parsed_domain = 'outlook.com' OR parsed_domain = 'icloud.com' OR parsed_domain = 'personal' THEN
    parsed_workspace := COALESCE(NEW.raw_user_meta_data->>'workspace_name', 'Personal Workspace');
  ELSE
    parsed_workspace := COALESCE(NEW.raw_user_meta_data->>'workspace_name', INITCAP(split_part(parsed_domain, '.', 1)) || ' Enterprise Workspace');
  END IF;

  full_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Phone User');
  phone_num := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone');

  INSERT INTO public.profiles (id, name, workspace_name, domain, phone, is_premium)
  VALUES (
    NEW.id,
    full_name,
    parsed_workspace,
    parsed_domain,
    phone_num,
    COALESCE((NEW.raw_user_meta_data->>'is_premium')::boolean, false)
  )
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      workspace_name = EXCLUDED.workspace_name,
      domain = EXCLUDED.domain,
      phone = EXCLUDED.phone;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to sync auth users inserts to profiles
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
