-- 108_remove_left_students_from_classes.sql
-- A withdrawn ("left") student was never removed from student_class when
-- their status changed, so class rosters and curriculum-block counts across
-- the app (mentor groups, class lists, block allocation, etc.) kept counting
-- them as present. Found via a live discrepancy: 10H/Me showed 13 enrolled
-- vs 11 active students in "10 Henry" — the difference was exactly 2
-- withdrawn students still linked to the class (plus 1 more in 10P/Me).
--
-- This only removes the *current enrolment link* (student_class). It does
-- not touch attendance, behaviour or results history, which reference the
-- student and class directly and stay intact regardless of enrolment.

-- One-off cleanup of every stale link that already exists.
delete from student_class
where student_id in (select student_id from students where status <> 'active');

-- Going forward: the moment a student's status changes away from 'active',
-- drop their class links automatically so this can't silently drift again.
create or replace function remove_class_links_on_student_leave()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'active' and (old.status is distinct from new.status) then
    delete from student_class where student_id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_remove_class_links_on_student_leave on students;
create trigger trg_remove_class_links_on_student_leave
  after update of status on students
  for each row execute function remove_class_links_on_student_leave();
