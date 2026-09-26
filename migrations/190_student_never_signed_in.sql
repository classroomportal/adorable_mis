-- 190_student_never_signed_in.sql
--
-- Backs the new /students/welcome-emails page ("Student Logins" under
-- Communication), the student counterpart of /staff/welcome-emails
-- (migration 122).
--
-- Student logins are already created automatically the moment a student
-- row gets a student_email (trg_provision_student_login, migration 110), so
-- there is nothing to create: every active student with an email has an
-- account (265 of 265 at the time of writing). What was missing is a way to
-- reach the ones who have never signed in (14 at the time of writing) --
-- staff and parents each have a page for that, students didn't.
--
-- Same shape as staff_never_signed_in(): auth.users isn't reachable over
-- PostgREST, so this answers only "which active students have never signed
-- in?" and returns only what the page shows. A SECURITY DEFINER function
-- guarded by is_admin(), not a view, for the same reason as 122 -- a view
-- over auth.users joined to students would be readable by anyone who can
-- read students. The page sends each one the ordinary password-reset link
-- (as /login/forgot does), so no password is minted or emailed.

create or replace function public.student_never_signed_in()
returns table(student_id integer, student_name text, year_group integer, email text, account_created timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can list students who have never signed in';
  end if;

  return query
    select s.student_id,
           trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
           s.year_group,
           s.student_email,
           u.created_at
    from students s
    join profiles p on p.student_id = s.student_id
    join auth.users u on u.id = p.id
    where s.status = 'active'
      and s.student_email is not null
      and u.last_sign_in_at is null
    order by s.year_group, s.last_name, s.first_name;
end;
$$;

revoke execute on function public.student_never_signed_in() from public;
revoke execute on function public.student_never_signed_in() from anon;
grant execute on function public.student_never_signed_in() to authenticated;

-- After the other Staff & Access pages (staff and parent logins are 94 and
-- 96; 97 is the last in use). Admin only, like the staff page.
insert into public.resources (resource_key, label, section, sort_order)
values ('/students/welcome-emails', 'Send Student Welcome Emails', 'Staff & Access', 98)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
values ('admin', '/students/welcome-emails')
on conflict do nothing;
