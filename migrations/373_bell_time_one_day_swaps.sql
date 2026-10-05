-- 373_bell_time_one_day_swaps.sql
--
-- On Monday 5 Oct 2026 the school ran Monday on Friday's (shorter) bell
-- times for that one day. The only way to do that in Formwork was to save
-- Friday's times onto Monday at /admin/bell-times and remember to put
-- Monday's back afterwards (it was done by hand through the connector).
-- The principal asked for a button to do this easily for any day.
--
-- bell_time_swaps: "on <date>, run that day on <another weekday>'s times".
--
--   * add_bell_time_swap(date, use_day, note) books one. If the date is
--     today it takes effect at once; otherwise the morning job applies it
--     on the day.
--   * Applying copies the times (and any day-specific name/short label) of
--     every period that runs on BOTH days from the other day onto the
--     day's bell_times rows. bell_times_apply then moves every class's
--     lessons, exactly as saving at /admin/bell-times does. Periods that run
--     on only one of the two days are left alone (no period is added or
--     taken off a day). What the rows held before is kept in saved_rows.
--   * The morning job after the date puts them back. A row is put back only
--     if it still holds the swapped-in times, so an edit someone saves at
--     /admin/bell-times during the day is not overwritten.
--   * cancel_bell_time_swap() cancels one; if it is in effect it is put
--     back at once.
--
-- One booking per date. Weekdays only (Sunday has no lessons). Allowed to
-- whoever can edit bell times (the bell_times 'edit' tick, admin today).
-- Rows are never deleted: cancelled ones keep who and when.
--
-- bell_time_swaps has select policies only; every write is one of the
-- functions here.

create table public.bell_time_swaps (
  id            bigint generated always as identity primary key,
  swap_on       date not null,
  day_of_week   text not null check (day_of_week in ('Mon','Tue','Wed','Thu','Fri')),
  use_day       text not null check (use_day in ('Mon','Tue','Wed','Thu','Fri')),
  note          text,
  saved_rows    jsonb,          -- per period: the day's row before, and what was put in
  applied_at    timestamptz,
  restored_at   timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint bell_time_swaps_other_day check (use_day <> day_of_week),
  constraint bell_time_swaps_day_matches check (
    day_of_week = (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from swap_on)::int])
);

create unique index bell_time_swaps_one_per_date
  on public.bell_time_swaps (swap_on) where cancelled_at is null;

alter table public.bell_time_swaps enable row level security;
grant select on public.bell_time_swaps to authenticated;

create policy staff_read_bell_time_swaps on public.bell_time_swaps
  for select using ((select is_staff_or_admin()));

create trigger stamp_bell_time_swap_created_by
  before insert on public.bell_time_swaps
  for each row execute function stamp_actor('created_by');

-- ------------------------------------------------------------ apply / restore

create or replace function public.bell_time_swap_apply(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s     bell_time_swaps%rowtype;
  saved jsonb := '[]'::jsonb;
  r     record;
begin
  select * into s from bell_time_swaps where id = p_id for update;
  if not found or s.applied_at is not null or s.cancelled_at is not null then
    return;
  end if;

  for r in
    select t.period_number,
           t.start_time  as old_start, t.end_time  as old_end,
           t.period_name as old_name,  t.short_label as old_label,
           f.start_time  as new_start, f.end_time  as new_end,
           f.period_name as new_name,  f.short_label as new_label
      from bell_times t
      join bell_times f on f.period_number = t.period_number and f.day_of_week = s.use_day
     where t.day_of_week = s.day_of_week
     order by t.period_number
  loop
    saved := saved || jsonb_build_object(
      'period_number', r.period_number,
      'old_start', r.old_start, 'old_end', r.old_end, 'old_name', r.old_name, 'old_label', r.old_label,
      'new_start', r.new_start, 'new_end', r.new_end, 'new_name', r.new_name, 'new_label', r.new_label);
    update bell_times
       set start_time = r.new_start, end_time = r.new_end,
           period_name = r.new_name, short_label = r.new_label
     where day_of_week = s.day_of_week and period_number = r.period_number
       and (start_time, end_time, period_name, short_label)
           is distinct from (r.new_start, r.new_end, r.new_name, r.new_label);
  end loop;

  update bell_time_swaps set saved_rows = saved, applied_at = now() where id = p_id;
end;
$$;

create or replace function public.bell_time_swap_restore(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s bell_time_swaps%rowtype;
  e jsonb;
begin
  select * into s from bell_time_swaps where id = p_id for update;
  if not found or s.applied_at is null or s.restored_at is not null then
    return;
  end if;

  for e in select * from jsonb_array_elements(coalesce(s.saved_rows, '[]'::jsonb))
  loop
    -- Only if the row still holds what the swap put there.
    update bell_times
       set start_time  = (e->>'old_start')::time,
           end_time    = (e->>'old_end')::time,
           period_name = e->>'old_name',
           short_label = e->>'old_label'
     where day_of_week = s.day_of_week
       and period_number = (e->>'period_number')::int
       and start_time = (e->>'new_start')::time
       and end_time   = (e->>'new_end')::time
       and period_name is not distinct from e->>'new_name'
       and short_label is not distinct from e->>'new_label';
  end loop;

  update bell_time_swaps set restored_at = now() where id = p_id;
end;
$$;

revoke execute on function public.bell_time_swap_apply(bigint) from public, anon, authenticated;
revoke execute on function public.bell_time_swap_restore(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------ morning job

create or replace function public.run_bell_time_swaps()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s record;
begin
  perform set_config('formwork.change_note', 'Bell time swap (scheduled)', true);
  for s in select id from bell_time_swaps
            where applied_at is not null and restored_at is null and swap_on < school_today()
            order by swap_on
  loop
    perform bell_time_swap_restore(s.id);
  end loop;
  for s in select id from bell_time_swaps
            where swap_on = school_today() and applied_at is null and cancelled_at is null
  loop
    perform bell_time_swap_apply(s.id);
  end loop;
end;
$$;

revoke execute on function public.run_bell_time_swaps() from public, anon, authenticated;

-- 03:45 UTC is 04:45 in Lagos, before the planned-absence job and registration.
select cron.schedule('run-bell-time-swaps', '45 3 * * *', 'select public.run_bell_time_swaps();');

-- ------------------------------------------------------------ from the app

create or replace function public.add_bell_time_swap(p_date date, p_use_day text, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_day text := (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from p_date)::int];
  v_id  bigint;
begin
  if not has_ability('bell_times', 'edit') then
    raise exception 'You can''t change bell times.';
  end if;
  if p_date is null or p_date < school_today() then
    raise exception 'Choose today or a later date.';
  end if;
  if v_day not in ('Mon','Tue','Wed','Thu','Fri') then
    raise exception 'Only a weekday can run on another day''s times.';
  end if;
  if p_use_day not in ('Mon','Tue','Wed','Thu','Fri') or p_use_day = v_day then
    raise exception 'Choose a different weekday''s times.';
  end if;
  if exists (select 1 from bell_time_swaps where swap_on = p_date and cancelled_at is null) then
    raise exception 'That date already runs on another day''s times. Cancel that first.';
  end if;

  insert into bell_time_swaps (swap_on, day_of_week, use_day, note)
  values (p_date, v_day, p_use_day, nullif(trim(p_note), ''))
  returning id into v_id;

  if p_date = school_today() then
    perform bell_time_swap_apply(v_id);
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_bell_time_swap(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s bell_time_swaps%rowtype;
begin
  if not has_ability('bell_times', 'edit') then
    raise exception 'You can''t change bell times.';
  end if;
  select * into s from bell_time_swaps where id = p_id for update;
  if not found or s.cancelled_at is not null then
    raise exception 'That booking isn''t there or is already cancelled.';
  end if;
  if s.restored_at is not null or s.swap_on < school_today() then
    raise exception 'That day is over.';
  end if;
  perform bell_time_swap_restore(p_id);
  update bell_time_swaps set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
end;
$$;

revoke execute on function public.add_bell_time_swap(date, text, text) from public, anon;
revoke execute on function public.cancel_bell_time_swap(bigint) from public, anon;
grant execute on function public.add_bell_time_swap(date, text, text) to authenticated;
grant execute on function public.cancel_bell_time_swap(bigint) to authenticated;
