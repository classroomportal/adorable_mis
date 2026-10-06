-- Supabase's security advisor flagged message_read_status as CRITICAL
-- ("Security Definer View", 6 Oct 2026). It was the last view without
-- security_invoker (sql/CURRENT_SCHEMA.md, Known gaps): it runs as its owner,
-- so RLS on the tables underneath is skipped and its own WHERE clause is the
-- only thing deciding who sees recipients' names and email addresses.
--
-- Simply switching it to security_invoker would break Message history
-- (/comms/history): message_recipients, profiles, students and parents are
-- RLS-scoped, so SMT would see 46 of 443 read receipts and pastoral/office 11
-- (tested 6 Oct 2026 as each role). The rule itself is sound (it checks the
-- caller through auth.uid(): admin, the message's sender, or smt / pastoral /
-- school_office), so it moves unchanged into a SECURITY DEFINER function and
-- the view becomes a security_invoker view over it. Same columns, same rows
-- for every caller, nothing for anon or a signed-in user without one of those.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.message_read_status_rows()
returns table (
  message_id bigint,
  profile_id uuid,
  read_at timestamptz,
  recipient_email text,
  recipient_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select mr.message_id,
         mr.profile_id,
         mr.read_at,
         coalesce(pr.email, par.email, s.student_email) as recipient_email,
         coalesce(stf.first_name || ' ' || stf.last_name,
                  s.first_name || ' ' || s.last_name,
                  par.first_name || ' ' || par.last_name) as recipient_name
    from message_recipients mr
    join profiles pr on pr.id = mr.profile_id
    left join staff stf on stf.staff_id = pr.staff_id
    left join students s on s.student_id = pr.student_id
    left join parents par on par.parent_id = pr.parent_id
   where auth.uid() is not null
     and (is_admin()
          or exists (select 1 from messages m
                      where m.id = mr.message_id
                        and (m.sent_by = auth.uid()
                             or user_has_staff_role(array['smt', 'pastoral', 'school_office']))));
$$;

revoke execute on function public.message_read_status_rows() from public, anon;
grant execute on function public.message_read_status_rows() to authenticated;

create or replace view public.message_read_status
with (security_invoker = true) as
  select * from public.message_read_status_rows();

revoke all on public.message_read_status from anon;
grant select on public.message_read_status to authenticated;
