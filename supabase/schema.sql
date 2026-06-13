-- ============================================================
-- Minerva Connect: canonical schema + security (data-safe, re-runnable)
-- Run this whole thing in the Supabase SQL Editor.
-- It does NOT drop tables and does NOT delete any data.
-- This file is the single source of truth for the database.
-- ============================================================

-- 1. Tables (created only if missing) ------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  role TEXT CHECK (role IN ('applicant', 'minervan')),
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  applicant_id UUID REFERENCES auth.users ON DELETE SET NULL,
  topic TEXT,
  target_college TEXT,
  content TEXT,
  context TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  minervan_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','resolved')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID REFERENCES public.threads(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- 2. Make sure all columns the app uses exist ----------------
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS first_name     TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS last_name      TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS preferred_name TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS class_year     TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS college        TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS country        TEXT;
ALTER TABLE public.profiles  ADD COLUMN IF NOT EXISTS gender         TEXT;

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS applicant_email TEXT;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS country         TEXT;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS priority_score  INT DEFAULT 3;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS spam_flag       BOOLEAN DEFAULT false;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS clarity_score   INT;

-- 3. Status values the app actually uses ---------------------
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_status_check;
ALTER TABLE public.questions ADD  CONSTRAINT questions_status_check
  CHECK (status IN ('open','matched','answered','resolved','flagged'));

-- 4. Turn RLS on everywhere ----------------------------------
ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages  ENABLE ROW LEVEL SECURITY;

-- 5. Wipe ALL old/duplicate policies (clean slate) -----------
DROP POLICY IF EXISTS "Allow public select"               ON public.questions;
DROP POLICY IF EXISTS "Allow public insert"               ON public.questions;
DROP POLICY IF EXISTS "Enable insert for all users"       ON public.questions;
DROP POLICY IF EXISTS "Enable select for all users"       ON public.questions;
DROP POLICY IF EXISTS "Anyone can submit a question"      ON public.questions;
DROP POLICY IF EXISTS "Minervans can view open questions" ON public.questions;
DROP POLICY IF EXISTS "Minervans can update questions"    ON public.questions;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can view their own threads" ON public.threads;
DROP POLICY IF EXISTS "Minervans can create threads"     ON public.threads;

DROP POLICY IF EXISTS "Users can view messages in their threads"   ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their threads" ON public.messages;

-- 6. Recreate the clean, correct policy set ------------------

-- QUESTIONS: anyone may submit; only Minervans may read/update
CREATE POLICY "Anyone can submit a question"
  ON public.questions FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Minervans can read questions"
  ON public.questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'minervan'));

CREATE POLICY "Minervans can update questions"
  ON public.questions FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'minervan'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'minervan'));

-- PROFILES: a user only sees/edits their own row
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- THREADS: the owning Minervan (or the applicant on the question) can see; Minervans create their own
CREATE POLICY "Users can view their own threads"
  ON public.threads FOR SELECT TO authenticated
  USING (
    auth.uid() = minervan_id
    OR EXISTS (SELECT 1 FROM public.questions q WHERE q.id = threads.question_id AND q.applicant_id = auth.uid())
  );
CREATE POLICY "Minervans can create threads"
  ON public.threads FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = minervan_id
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'minervan')
  );

-- MESSAGES: only people in the thread can read/write
CREATE POLICY "Users can view messages in their threads"
  ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.threads t WHERE t.id = messages.thread_id AND (
      t.minervan_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.questions q WHERE q.id = t.question_id AND q.applicant_id = auth.uid())
    )
  ));
CREATE POLICY "Users can insert messages in their threads"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.threads t WHERE t.id = messages.thread_id AND (
        t.minervan_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.questions q WHERE q.id = t.question_id AND q.applicant_id = auth.uid())
      )
    )
  );

-- 7. Realtime on messages (safely skip if already added) -----
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication, ignore
END $$;

-- 8. Signup trigger: tag Minervans by email domain -----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.email LIKE '%@uni.minerva.edu') THEN
    INSERT INTO public.profiles (id, role, is_verified) VALUES (NEW.id, 'minervan', true);
  ELSE
    INSERT INTO public.profiles (id, role, is_verified) VALUES (NEW.id, 'applicant', false);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
