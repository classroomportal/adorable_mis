-- Migration 158: take Nova-T's whole-year Other Half and Sports Academy
-- groups off students' timetables and class allocations.
--
-- Why: Nova-T put every student in a year into two groups in the Other Half
-- slot — "Other Half" (7a/Oh1 .. 11w/Oh1, Mon–Fri) and "Sports" / Sports
-- Academy (77/Sa1, 87/Sa1, 98/Sa1, 109/Sa1, 11w/Sa1, one day each). Neither
-- is real: nobody is in "Other Half", and Sports Academy is something a
-- student chooses, not something a whole year is placed in. With the OH
-- programme now in Formwork (migration 156), these groups only put a
-- misleading OH lesson on every student's timetable and make it look as if
-- the OH slot was already filled for them. Sports Academy is to be entered
-- as an Other Half activity instead, so it is a positive choice.
--
-- Checked against live data before writing this: all ten classes are
-- whole-year groups (41–60 students each, 460 links in all), every one of
-- their timetable slots is in the OH period, and no behaviour event points
-- at any of them. Attendance is keyed on student/date/period, not class, so
-- OH marks already taken stay exactly as they are.
--
-- The classes are deleted outright, not just emptied: an empty Sports class
-- with a teacher still shows on that teacher's timetable. The Nova-T
-- importer now skips Oh and Sa groups (app/admin/import-classes), so a
-- later import can't bring them back.

create temp table legacy_oh_classes on commit drop as
select c.class_id
  from classes c
  join subjects s on s.subject_id = c.subject_id
 where lower(s.subject_code) in ('oh', 'sa')
   -- Guard: only groups that live entirely in the OH slot.
   and not exists (select 1 from timetable_slots ts
                    where ts.class_id = c.class_id
                      and ts.period_number <> (select period_number from periods where short_label = 'OH'));

delete from student_class   where class_id in (select class_id from legacy_oh_classes);
delete from timetable_slots where class_id in (select class_id from legacy_oh_classes);
update behaviour_events set class_id = null where class_id in (select class_id from legacy_oh_classes);
delete from classes         where class_id in (select class_id from legacy_oh_classes);
