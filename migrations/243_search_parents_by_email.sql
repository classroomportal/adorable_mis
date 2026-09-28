-- Migration 243: find a parent by email on the compose page.
--
-- Why (principal, 28 Sept 2026): staff need to find a parent by their email
-- address, not only by name. search_people(), which the "A specific person"
-- search on /comms/compose uses, only matched names. A parent now also
-- matches on the email they sign in with (profiles.email) or the email on
-- their parent record, and the result shows the login email first, since
-- that's where an individual message is emailed.
--
-- Parents are limited to those with at least one active student, the same
-- rule "All parents" follows since migration 237. Without it, searching an
-- email would also turn up the 733 parent logins created on 3 Sept that are
-- linked to no child, alongside the real parent.
--
-- Still SECURITY INVOKER: what a caller can find is decided by the RLS on
-- profiles, parents, staff and students, as before.

create or replace function public.search_people(p_query text)
returns table(profile_id uuid, display_name text, email text, person_type text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, stf.first_name || ' ' || stf.last_name, p.email, 'staff'
  from profiles p
  join staff stf on stf.staff_id = p.staff_id
  where stf.first_name || ' ' || stf.last_name ilike '%' || p_query || '%'
  union all
  select p.id, par.first_name || ' ' || par.last_name, coalesce(p.email, par.email), 'parent'
  from profiles p
  join parents par on par.parent_id = p.parent_id
  where (par.first_name || ' ' || par.last_name ilike '%' || p_query || '%'
         or p.email ilike '%' || trim(p_query) || '%'
         or par.email ilike '%' || trim(p_query) || '%')
    and exists (
      select 1 from student_parent sp
      join students s on s.student_id = sp.student_id
      where sp.parent_id = p.parent_id and s.status = 'active'
    )
  union all
  select p.id, s.first_name || ' ' || s.last_name, s.student_email, 'student'
  from profiles p
  join students s on s.student_id = p.student_id
  where s.status = 'active'
    and s.first_name || ' ' || s.last_name ilike '%' || p_query || '%'
  limit 20;
$function$;
