-- =========================================================
-- Luniva — feedback summary (read-only views for you)
-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- (Needs luniva_feedback.sql to have been run first.)
--
-- Then open Table Editor and click:
--   • luniva_feedback_summary  → totals, average rating, topics
--   • luniva_feedback_by_week  → the same, week by week
--   • luniva_feedback_to_reply → messages where someone asked for a reply
-- Views always show live numbers; nothing extra is stored.
-- The website can't read them (same as the feedback itself).
-- =========================================================

create or replace view public.luniva_feedback_summary
with (security_invoker = on) as
select
  count(*)                                                     as total_messages,
  round(avg(rating), 2)                                        as average_rating,
  count(*) filter (where rating >= 4)                          as happy_4_or_5,
  count(*) filter (where rating <= 2)                          as unhappy_1_or_2,
  count(*) filter (where category = 'bug')                     as problems,
  count(*) filter (where category = 'idea')                    as ideas,
  count(*) filter (where category = 'love')                    as loves,
  count(*) filter (where category = 'other')                   as other,
  count(*) filter (where created_at > now() - interval '7 days') as last_7_days,
  count(*) filter (where contact_email is not null)            as want_a_reply,
  count(*) filter (where app_installed)                        as from_installed_app,
  max(created_at)                                              as latest_message_at
from public.luniva_feedback;

create or replace view public.luniva_feedback_by_week
with (security_invoker = on) as
select
  date_trunc('week', created_at)::date      as week_starting,
  count(*)                                  as messages,
  round(avg(rating), 2)                     as average_rating,
  count(*) filter (where category = 'bug')  as problems,
  count(*) filter (where category = 'idea') as ideas,
  count(*) filter (where category = 'love') as loves,
  count(*) filter (where category = 'other') as other
from public.luniva_feedback
group by 1
order by 1 desc;

create or replace view public.luniva_feedback_to_reply
with (security_invoker = on) as
select created_at, contact_email, rating, category, message, page, device
from public.luniva_feedback
where contact_email is not null
order by created_at desc;

revoke all on public.luniva_feedback_summary, public.luniva_feedback_by_week, public.luniva_feedback_to_reply
  from anon, authenticated;
