-- =========================================================
-- Luniva — encrypted sync table
-- Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- Each account gets ONE row holding its health records as
-- ciphertext. Records are encrypted in the browser with the
-- user's sync passphrase (AES-256-GCM, key from PBKDF2) before
-- upload, so this table never contains readable health data.
-- Row Level Security makes each row visible only to its owner.
-- =========================================================

create table if not exists public.luniva_sync (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  ciphertext  text        not null,              -- base64 AES-GCM output
  iv          text        not null,              -- base64 12-byte nonce
  salt        text        not null,              -- base64 PBKDF2 salt
  iterations  integer     not null default 600000,
  updated_at  timestamptz not null default now()
);

-- Only signed-in users, and only their own row.
alter table public.luniva_sync enable row level security;

drop policy if exists "Read own sync row"   on public.luniva_sync;
drop policy if exists "Insert own sync row" on public.luniva_sync;
drop policy if exists "Update own sync row" on public.luniva_sync;
drop policy if exists "Delete own sync row" on public.luniva_sync;

create policy "Read own sync row" on public.luniva_sync
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Insert own sync row" on public.luniva_sync
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Update own sync row" on public.luniva_sync
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Delete own sync row" on public.luniva_sync
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Logged-out visitors get no access at all.
revoke all on public.luniva_sync from anon;
grant select, insert, update, delete on public.luniva_sync to authenticated;

-- The server sets updated_at, so devices can tell when another device synced.
create or replace function public.luniva_sync_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists luniva_sync_touch on public.luniva_sync;
create trigger luniva_sync_touch
  before insert or update on public.luniva_sync
  for each row execute function public.luniva_sync_touch();
