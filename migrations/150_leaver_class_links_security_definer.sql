-- Migration 150: removing a leaver from their classes works whoever marks them left.
--
-- School office can now edit a student's core data from /students/[id]
-- (their update rights on students already existed in RLS; only the page's
-- Edit button was admin-only). Core data includes status and leaving date,
-- and marking a student left fires trg_remove_class_links_on_student_leave
-- (migration 108), which deletes their student_class rows.
--
-- That function was SECURITY INVOKER, so the delete ran under the editor's
-- own RLS. student_class writes are limited to can_allocate_classes()
-- (admin, head_of_department, pastoral), so for school_office the delete
-- would match zero rows without raising — the leaver would stay on every
-- register and class list. Run it as the owner instead: it only ever fires
-- from an update to students that RLS has already allowed, and it only
-- touches that one student's rows.

create or replace function remove_class_links_on_student_leave()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status <> 'active' and (old.status is distinct from new.status) then
    delete from student_class where student_id = new.student_id;
  end if;
  return new;
end;
$$;
