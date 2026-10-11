-- =========================================================
-- Luniva — phone reminders (web push)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (push-setup.html shows this together with the schedule part.)
--
-- One row per device that turned reminders on. It holds only the
-- browser's push address, the chosen hour and the time zone —
-- no health data. Each person can only see and change their own rows.
-- =========================================================

create table if not exists public.luniva_push (
  endpoint      text primary key check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  remind_hour   smallint not null default 20 check (remind_hour between 0 and 23),
  timezone      text not null default 'UTC' check (char_length(timezone) <= 64),
  last_sent_on  date,
  created_at    timestamptz not null default now()
);

create index if not exists luniva_push_user_id_idx on public.luniva_push (user_id);

alter table public.luniva_push enable row level security;

drop policy if exists "Read own push devices" on public.luniva_push;
drop policy if exists "Add own push devices" on public.luniva_push;
drop policy if exists "Update own push devices" on public.luniva_push;
drop policy if exists "Remove own push devices" on public.luniva_push;

create policy "Read own push devices" on public.luniva_push
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Add own push devices" on public.luniva_push
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Update own push devices" on public.luniva_push
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Remove own push devices" on public.luniva_push
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.luniva_push from anon, authenticated;
grant select, insert, update, delete on public.luniva_push to authenticated;
