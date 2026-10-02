-- Migration 316: the dashboard's card counts and staff-parent lookup, cheaply.
--
-- Why (the principal, 2 Oct 2026, after migration 315): at 08:00 the database
-- was saturated as staff signed in. After the timetable's register count (315),
-- the next heaviest reads all ran on every dashboard load:
--   * the module-card counts (active students, staff, behaviour alerts), three
--     head-count requests through students' and behaviour_events' RLS:
--     students about 256 ms (25,900 calls), behaviour about 191 ms (10,400);
--   * findParentIdByEmail() (lib/parentByEmail.js), which asks whether a member
--     of staff is also a parent: an ilike over all 1,581 parents with every
--     parents policy checked per row, about 1 s (7,000 calls), for every staff
--     login without profiles.parent_id. Only one login matches at all.
-- Both now run as SECURITY DEFINER with the caller's rights checked once at
-- the top, so the answers are the same as before:
--
-- dashboard_card_counts() returns {students, staff, behaviour_alerts}. Each is
-- null unless the caller is staff (is_staff_or_admin(), as the staff read
-- policies require) and has that card's page (has_resource_access(), the same
-- rule as the page's hasAccess(): /students, /staff/roles, /behaviour). Demo
-- rows are left out as before (is_demo = false; the demo account is gone).
-- Behaviour alerts are negative, not voided, at most -3 points, in the last
-- 7 days (from the school's today), as the card counted them.
--
-- my_parent_id_by_email() returns the parents row whose email matches the
-- caller's (profiles.email, else the sign-in email, ignoring case), but only
-- when the caller could already read that row under parents' policies (own
-- linked row, pastoral/SMT, school office, admin), so nobody newly gains a
-- "My Children" tile. It takes no arguments: the email is never the request's.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.dashboard_card_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_students integer;
  v_staff integer;
  v_alerts integer;
begin
  if not is_staff_or_admin() then
    return jsonb_build_object('students', null, 'staff', null, 'behaviour_alerts', null);
  end if;

  if has_resource_access('/students') then
    select count(*) into v_students from students where status = 'active' and is_demo = false;
  end if;

  if has_resource_access('/staff/roles') then
    select count(*) into v_staff from staff where is_demo = false;
  end if;

  if has_resource_access('/behaviour') then
    select count(*) into v_alerts
    from behaviour_events
    where type = 'negative' and points <= -3 and voided_at is null and is_demo = false
      and event_date >= school_today() - 7;
  end if;

  return jsonb_build_object('students', v_students, 'staff', v_staff, 'behaviour_alerts', v_alerts);
end;
$$;

revoke execute on function public.dashboard_card_counts() from public, anon;
grant execute on function public.dashboard_card_counts() to authenticated;

create or replace function public.my_parent_id_by_email()
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text;
  v_own_parent integer;
  v_parent integer;
begin
  select lower(trim(coalesce(nullif(p.email, ''), u.email))), p.parent_id
    into v_email, v_own_parent
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid();

  if v_email is null or v_email = '' then
    return null;
  end if;

  select pa.parent_id into v_parent
  from parents pa
  where lower(pa.email) = v_email
  order by pa.parent_id
  limit 1;

  if v_parent is null then
    return null;
  end if;

  -- Only what parents' read policies already showed this caller.
  if v_parent = v_own_parent
     or is_admin()
     or is_pastoral_or_smt()
     or user_has_staff_role(array['school_office']) then
    return v_parent;
  end if;
  return null;
end;
$$;

revoke execute on function public.my_parent_id_by_email() from public, anon;
grant execute on function public.my_parent_id_by_email() to authenticated;
