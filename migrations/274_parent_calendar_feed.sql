-- Migration 274: a private calendar subscription link for each parent.
--
-- Why: the principal noticed (30 Sept 2026) that "Add all upcoming events" on
-- /parent-portal/calendar puts a one-off copy of the school calendar into a
-- parent's phone. When SMT later move, rename or cancel an event, the
-- parent's copy never changes. To stay in step, the parent's calendar app has
-- to fetch the calendar again by itself, which it can only do from a link
-- that works without signing in (calendar apps can't sign in to Formwork).
--
-- The principal chose a private link per parent over one shared school link:
-- each parent gets their own secret token, shown only to them in the portal,
-- which they can reset if it leaks, and which stops returning anything once
-- none of their children is still at the school (the migration 255 rule).
-- The feed carries only what the parents' calendar page already shows:
-- school events from the start of the current academic year onwards, without
-- the staff-only categories (Teacher Assessment weeks, report periods).
--
-- parent_calendar_feeds is reached only through the two functions below, so
-- the API roles get no table grant at all.
--   * my_calendar_feed_token(p_reset) - the signed-in parent's own token,
--     created on first use; p_reset replaces it, so the old link stops working.
--     The parent is taken from auth.uid(), never from the request.
--   * calendar_feed_events(p_token) - the events for a token. Callable by
--     anon, because the feed route (app/api/calendar-feed/[token]/route.js)
--     has no sign-in; the token itself is the check. It is 128 random bits,
--     so it can't be guessed, and an unknown token returns nothing.

set local formwork.change_note = 'Principal (direct)';

create table public.parent_calendar_feeds (
  parent_id integer primary key references public.parents(parent_id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.parent_calendar_feeds enable row level security;
revoke all on public.parent_calendar_feeds from public, anon, authenticated;

comment on table public.parent_calendar_feeds is
  'Secret per-parent token for the school calendar subscription feed (migration 274). Read only through my_calendar_feed_token() and calendar_feed_events().';

create or replace function public.my_calendar_feed_token(p_reset boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_parent_id integer;
  v_token text;
begin
  select p.parent_id into v_parent_id from profiles p where p.id = auth.uid();
  if v_parent_id is null then
    raise exception 'Only a parent login has a calendar subscription link.';
  end if;

  if p_reset then
    delete from parent_calendar_feeds where parent_id = v_parent_id;
  end if;

  insert into parent_calendar_feeds (parent_id, token)
  values (v_parent_id, encode(gen_random_bytes(16), 'hex'))
  on conflict (parent_id) do nothing;

  select f.token into v_token from parent_calendar_feeds f where f.parent_id = v_parent_id;
  return v_token;
end;
$$;

revoke execute on function public.my_calendar_feed_token(boolean) from public, anon;
grant execute on function public.my_calendar_feed_token(boolean) to authenticated;

create or replace function public.calendar_feed_events(p_token text)
returns table (event_id integer, event_date date, event_name text, category text, year_group_note text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.event_id, e.event_date, e.event_name, e.category, e.year_group_note
  from calendar_events e
  where exists (
      select 1
      from parent_calendar_feeds f
      join student_parent sp on sp.parent_id = f.parent_id
      join students s on s.student_id = sp.student_id
      where f.token = p_token
        and s.status = 'active'
    )
    and e.category not in ('teacher_assessment', 'report_period')
    and e.event_date >= coalesce(
      (select y.start_date from academic_years y where y.status = 'current'),
      current_date - 365)
  order by e.event_date, e.event_id;
$$;

revoke execute on function public.calendar_feed_events(text) from public;
grant execute on function public.calendar_feed_events(text) to anon, authenticated;
