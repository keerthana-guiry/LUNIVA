-- =========================================================
-- Luniva — feedback table
-- Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- Anyone using Luniva (logged in or not) can SEND feedback.
-- Nobody can READ it through the website — only you, in the
-- Supabase dashboard (Table Editor → luniva_feedback).
-- =========================================================

create table if not exists public.luniva_feedback (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  user_id        uuid default auth.uid() references auth.users (id) on delete set null,
  rating         smallint not null check (rating between 1 and 5),
  category       text not null check (category in ('bug', 'idea', 'love', 'other')),
  message        text not null check (char_length(message) between 3 and 2000),
  contact_email  text check (contact_email is null or char_length(contact_email) <= 254),
  page           text check (page is null or char_length(page) <= 100),
  device         text check (device is null or char_length(device) <= 300),
  app_installed  boolean not null default false
);

alter table public.luniva_feedback enable row level security;

drop policy if exists "Anyone can send feedback" on public.luniva_feedback;

-- Insert only. Logged-in senders can only attach their own user id.
create policy "Anyone can send feedback" on public.luniva_feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- No select/update/delete policies: the website can never read feedback back.
revoke all on public.luniva_feedback from anon, authenticated;
grant insert on public.luniva_feedback to anon, authenticated;
