-- Migration 184: staff meetings and part-time days at their real times, and
-- student 297 in the Year 7 girls' PE group.
--
-- Why: /admin/import-staff-commitments decoded Nova-T's NCLASS.DAT slot
-- numbers period-major (day = (slot-1) % 5), but Nova-T numbers slots
-- day-major, 9 periods a day, exactly as TBTRA-F.DAT does (lib/novaTSlots,
-- verified in sql/015). So every stored commitment was on the wrong day and
-- period:
--   - MOB's part-time non-working periods were scattered across the week
--     and sat on top of MOB's own 7C registrations and 11w Spanish; read
--     properly they are all of Monday and Thursday, Lessons 1-6.
--   - The SLT meeting (CBT, MEK, RIG, UMB) sat on Wednesday's Other Half
--     and Tuesday registration (over MEK's 7L registration); it is Friday
--     Lesson 1 and Monday Lesson 1.
--   - The Wednesday Lesson 4 meeting was unaffected (slot 23 reads the same
--     both ways).
-- Every row came from that importer (nothing else writes this table), so
-- the original slot is recoverable: slot = (period - 1) * 5 + day index + 1.
-- Each row is re-decoded day-major. Rows are rewritten through a temporary
-- copy so the unique (staff_id, day, period) key never sees two rows in one
-- place mid-update; ids, labels and created_at are kept.
--
-- Left as it is: CUE's Wednesday Lesson 4 meeting overlaps CUE's 9G1/Bs.
-- Nova-T has CUE in slot 23 in both NCLASS.DAT and TBTRA.DAT, so that is
-- in the school's timetable, not an import error.
--
-- Also: student 297 (7C, female) joins 7GIR/Pe (Monday Lesson 1, free in
-- her timetable), as the school asked on 26 Sep 2026 — every other Year 7
-- pupil already has a boys' or girls' PE group.

do $$
declare
  n integer;
begin
  create temporary table commitments_184 as
  select sc.commitment_id, sc.staff_id, sc.label, sc.is_demo, sc.created_at,
         (sc.period_number - 1) * 5 + d.i + 1 as slot
    from staff_commitments sc
    join (values ('Mon', 0), ('Tue', 1), ('Wed', 2), ('Thu', 3), ('Fri', 4)) d (day_of_week, i)
      on d.day_of_week = sc.day_of_week;

  select count(*) into n from commitments_184;
  if n <> 31 or n <> (select count(*) from staff_commitments) then
    raise exception 'expected 31 commitments to move, found %', n;
  end if;
  if exists (select 1 from commitments_184 where slot < 1 or slot > 45) then
    raise exception 'a commitment slot is outside Mon-Fri';
  end if;

  delete from staff_commitments;

  insert into staff_commitments (commitment_id, staff_id, day_of_week, period_number, label, is_demo, created_at)
  select commitment_id,
         staff_id,
         (array['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])[(slot - 1) / 9 + 1],
         (slot - 1) % 9 + 1,
         label,
         is_demo,
         created_at
    from commitments_184;
  get diagnostics n = row_count;
  if n <> 31 then
    raise exception 'expected to rewrite 31 commitments, wrote %', n;
  end if;

  drop table commitments_184;
end $$;

do $$
declare
  n integer;
begin
  insert into student_class (student_id, class_id)
  select 297, c.class_id
    from classes c
   where c.class_code = '7GIR/Pe'
     and exists (select 1 from students where student_id = 297 and year_group = 7 and status = 'active')
  on conflict (student_id, class_id) do nothing;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to add student 297 to 7GIR/Pe, added %', n;
  end if;
end $$;
