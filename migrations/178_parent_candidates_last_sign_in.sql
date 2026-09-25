-- Migration 178: show which parents have signed in.
--
-- Why: after the welcome letters went out there was nowhere to see which
-- parents had actually logged in. parent_welcome_candidates() reports one
-- status per parent and 'sent' outranks 'signed_in', so a parent who got
-- the letter and then signed in still read "Already sent" on
-- /parents/welcome-emails. It now also returns last_sign_in_at, which the
-- page uses for a "Signed in" filter and count. Status is unchanged, so
-- what can be sent is decided exactly as before.
--
-- Adding an output column changes the return type, so the function is
-- dropped and recreated; grants are restated as in migration 172.

drop function if exists public.parent_welcome_candidates();

create function public.parent_welcome_candidates()
returns table (
  parent_id integer,
  parent_name text,
  email text,
  children text,
  years integer[],
  status text,
  sent_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  return query
  with kids as (
    select sp.parent_id,
           array_agg(distinct s.year_group order by s.year_group) as years,
           string_agg(distinct s.first_name || ' ' || s.last_name || ' (Y' || s.year_group || ')', ', ') as children
    from student_parent sp
    join students s on s.student_id = sp.student_id
    where s.status = 'active'
    group by sp.parent_id
  )
  select p.parent_id,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         coalesce(u.email::text, nullif(lower(trim(p.email)), '')),
         k.children,
         k.years,
         case
           when ws.parent_id is not null then 'sent'
           when u.last_sign_in_at is not null then 'signed_in'
           when u.id is null and coalesce(trim(p.email), '') = '' then 'no_email'
           when parent_first_password(p.parent_id) is null then 'no_dob'
           when u.id is null and exists (
             select 1 from auth.users x where lower(x.email) = lower(trim(p.email))
           ) then 'email_shared'
           else 'ready'
         end,
         ws.sent_at,
         u.last_sign_in_at
  from parents p
  join kids k on k.parent_id = p.parent_id
  left join lateral (
    select pr.id from profiles pr
    where pr.parent_id = p.parent_id and pr.role = 'parent'
    limit 1
  ) login on true
  left join auth.users u on u.id = login.id
  left join parent_welcome_sends ws on ws.parent_id = p.parent_id
  order by p.last_name, p.first_name;
end;
$$;

revoke execute on function public.parent_welcome_candidates() from public, anon;
grant execute on function public.parent_welcome_candidates() to authenticated;
