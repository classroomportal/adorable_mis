-- Migration 079: reset_demo_data() — delete-then-reseed, one function for both jobs
-- Run this once by hand after migrating (074-078) to do the initial seed, then it's
-- what the nightly cron job (080) calls every night. Deletes every is_demo row in FK
-- order, then reinserts a fixed baseline so a bookmarked URL like /students/900007
-- keeps pointing at the same fake student after every reset. Amara Fashola's own
-- staff row (900001, added in 078) is never touched here — see that file's header.
--
-- Fixed IDs (900001+) are chosen far out of range of any real row for the
-- foreseeable lifetime of the school's real headcount, and are inserted explicitly
-- rather than left to the SERIAL sequence, so they stay stable across resets.
--
-- Reuses real subjects/periods/a real result-set calendar event rather than faking
-- them (see the design notes) — if your school has no subject matching "math" or
-- "english", or no calendar_events row with is_result_set=true yet, the relevant
-- seed rows are skipped defensively rather than erroring; tell me and I'll adjust
-- the lookups.

create or replace function reset_demo_data() returns void
language plpgsql security definer as $$
declare
  v_maths_subject_id integer;
  v_english_subject_id integer;
  v_periods int[];
  v_result_event_id integer;
  v_result_event_date date;
  v_sat date;
begin
  -- 1. Delete every demo row, children first.
  delete from behaviour_appeals where is_demo = true;
  delete from certificates_awarded where is_demo = true;
  delete from target_grades where is_demo = true;
  delete from results where is_demo = true;
  delete from behaviour_events where is_demo = true;
  delete from attendance where is_demo = true;
  delete from student_class where is_demo = true;
  delete from timetable_slots where is_demo = true;
  delete from classes where is_demo = true;
  delete from students where is_demo = true;
  -- staff (Amara, 900001) intentionally not deleted — see 078's header.

  -- 2. Look up real reference data to reuse (Tier 3 — never faked, see design notes).
  select subject_id into v_maths_subject_id from subjects where subject_name ilike '%math%' limit 1;
  select subject_id into v_english_subject_id from subjects where subject_name ilike '%english%' limit 1;
  select array_agg(period_number order by period_number) into v_periods
    from (select period_number from periods order by period_number limit 4) t;
  select event_id, event_date into v_result_event_id, v_result_event_date
    from calendar_events where is_result_set = true order by event_date desc limit 1;

  -- Most recent Saturday through the coming Friday — same window app/detention/page.js
  -- computes client-side, so seeded negative points always land inside "this week"
  -- however many days it's been since the last reset actually ran.
  v_sat := current_date - ((extract(dow from current_date)::int - 6 + 7) % 7);

  -- 3. Students (15, form '8-DEMO' so is_demo rows are also eyeballable at a glance).
  insert into students (student_id, first_name, last_name, dob, year_group, form_class, gender, status, is_demo) values
    (900001, 'Ibrahim',  'Musa',        '2018-03-11', 8, '8-DEMO', 'M', 'active', true),
    (900002, 'Ngozi',    'Nwachukwu',   '2018-06-02', 8, '8-DEMO', 'F', 'active', true),
    (900003, 'Tunde',    'Balogun',     '2018-01-22', 8, '8-DEMO', 'M', 'active', true),
    (900004, 'Chinedu',  'Igwe',        '2018-09-14', 8, '8-DEMO', 'M', 'active', true),
    (900005, 'David',    'Peters',      '2018-04-30', 8, '8-DEMO', 'M', 'active', true),
    (900006, 'Blessing', 'Kalu',        '2018-11-05', 8, '8-DEMO', 'F', 'active', true),
    (900007, 'Emeka',    'Uche',        '2018-02-17', 8, '8-DEMO', 'M', 'active', true),
    (900008, 'Grace',    'Thomas',      '2018-07-09', 8, '8-DEMO', 'F', 'active', true),
    (900009, 'Samuel',   'Danladi',     '2018-05-26', 8, '8-DEMO', 'M', 'active', true),
    (900010, 'Amina',    'Suleiman',    '2018-08-19', 8, '8-DEMO', 'F', 'active', true),
    (900011, 'Victor',   'Okoro',       '2018-10-03', 8, '8-DEMO', 'M', 'active', true),
    (900012, 'Patience', 'Effiong',     '2018-12-27', 8, '8-DEMO', 'F', 'active', true),
    (900013, 'Yusuf',    'Garba',       '2018-01-08', 8, '8-DEMO', 'M', 'active', true),
    (900014, 'Chidera',  'Nnamdi',      '2018-03-31', 8, '8-DEMO', 'F', 'active', true),
    (900015, 'Miriam',   'Okonkwo',     '2018-06-21', 8, '8-DEMO', 'F', 'active', true)
  on conflict (student_id) do nothing;

  -- 4. Two classes taught by Amara, reusing whichever real subjects matched above.
  if v_maths_subject_id is not null then
    insert into classes (class_id, subject_id, staff_id, year_group, room, class_code, is_demo)
      values (900001, v_maths_subject_id, 900001, 8, 'DEMO1', 'DEMO/Ma1', true)
      on conflict (class_id) do nothing;
  end if;
  if v_english_subject_id is not null then
    insert into classes (class_id, subject_id, staff_id, year_group, room, class_code, is_demo)
      values (900002, v_english_subject_id, 900001, 8, 'DEMO1', 'DEMO/En1', true)
      on conflict (class_id) do nothing;
  end if;

  -- 5. A couple of timetable slots per class, using real period numbers.
  if v_maths_subject_id is not null and array_length(v_periods, 1) >= 2 then
    insert into timetable_slots (class_id, day_of_week, period_number, is_demo) values
      (900001, 'Mon', v_periods[1], true),
      (900001, 'Wed', v_periods[2], true);
  end if;
  if v_english_subject_id is not null and array_length(v_periods, 1) >= 4 then
    insert into timetable_slots (class_id, day_of_week, period_number, is_demo) values
      (900002, 'Tue', v_periods[3], true),
      (900002, 'Thu', v_periods[4], true);
  end if;

  -- 6. Enroll every demo student in both demo classes.
  if v_maths_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900001, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;
  if v_english_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900002, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;

  -- 7. Results — a realistic spread, reusing a real result-set event if one exists.
  if v_maths_subject_id is not null and v_result_event_id is not null then
    insert into results (student_id, subject_id, result_set_event_id, week_start_date, score, max_score, grade, staff_id, is_demo) values
      (900001, v_maths_subject_id, v_result_event_id, v_result_event_date, 88, 100, 'A',  900001, true),
      (900002, v_maths_subject_id, v_result_event_id, v_result_event_date, 95, 100, 'A*', 900001, true),
      (900003, v_maths_subject_id, v_result_event_id, v_result_event_date, 72, 100, 'B',  900001, true),
      (900004, v_maths_subject_id, v_result_event_id, v_result_event_date, 58, 100, 'D',  900001, true),
      (900005, v_maths_subject_id, v_result_event_id, v_result_event_date, 91, 100, 'A*', 900001, true),
      (900006, v_maths_subject_id, v_result_event_id, v_result_event_date, 66, 100, 'C',  900001, true),
      (900007, v_maths_subject_id, v_result_event_id, v_result_event_date, 45, 100, 'E',  900001, true),
      (900008, v_maths_subject_id, v_result_event_id, v_result_event_date, 79, 100, 'B',  900001, true)
    on conflict (student_id, subject_id, result_set_event_id) do nothing;
  end if;

  -- 8. Target grades for every demo student, in whichever demo subjects exist.
  if v_maths_subject_id is not null then
    insert into target_grades (student_id, subject_id, target_grade, is_demo)
      select student_id, v_maths_subject_id, (array['A*','A','B','C','D'])[1 + (student_id % 5)], true
      from students where is_demo = true and student_id between 900001 and 900015
      on conflict (student_id, subject_id) do nothing;
  end if;
  if v_english_subject_id is not null then
    insert into target_grades (student_id, subject_id, target_grade, is_demo)
      select student_id, v_english_subject_id, (array['A','B','C','D'])[1 + (student_id % 4)], true
      from students where is_demo = true and student_id between 900001 and 900015
      on conflict (student_id, subject_id) do nothing;
  end if;

  -- 9. Behaviour — a mix, including one student over the detention threshold
  --    (10+ negative points, Sat-Fri) and one single-event alert (-4 or worse)
  --    with a pre-seeded pending appeal for SMT to practise approving/rejecting.
  insert into behaviour_events (student_id, staff_id, event_date, type, category, points, description, is_demo) values
    (900002, 900001, v_sat + 2, 'positive', 'Excellent work',  3,  'Outstanding maths homework.', true),
    (900005, 900001, v_sat + 3, 'positive', 'Helping others',  2,  null, true),
    (900010, 900001, v_sat + 4, 'positive', 'Kindness',        2,  null, true),
    -- Emeka Uche (900007): four negative events totalling 11 points this week, over the 10-point threshold.
    (900007, 900001, v_sat + 1, 'negative', 'Late to lesson',        -1, 'Arrived 10 minutes late.', true),
    (900007, 900001, v_sat + 2, 'negative', 'Disruption in class',   -2, null, true),
    (900007, 900001, v_sat + 3, 'negative', 'Mobile phone misuse',   -2, 'Phone out during the lesson.', true),
    (900007, 900001, v_sat + 4, 'negative', 'Rudeness/disrespect',   -3, null, true),
    (900007, 900001, v_sat + 4, 'negative', 'Truancy',               -3, 'Missed period 3 without a note.', true),
    -- Grace Thomas (900008): one serious single event, pre-seeded with a pending appeal.
    (900008, 900001, v_sat + 2, 'negative', 'Physical altercation',  -5, 'Pushed another student in the corridor.', true),
    -- Samuel Danladi (900009): one inflated-value event so a certificate is pending to award —
    -- deliberately not a realistic single-event point value, just enough to clear the
    -- 100-point Bronze milestone in one seed row rather than dozens of small ones.
    (900009, 900001, v_sat + 3, 'positive', 'Leadership', 110, 'Cumulative term contribution recognised in one training seed row.', true)
  on conflict do nothing;

  insert into behaviour_appeals (event_id, student_id, reason, is_demo)
    select event_id, 900008, 'I was defending myself after being pushed first — please review the corridor camera footage.', true
    from behaviour_events
    where student_id = 900008 and category = 'Physical altercation' and is_demo = true
    order by event_id desc limit 1;

  -- 10. One certificate already on record, so the "awarded" history isn't empty either.
  insert into certificates_awarded (student_id, milestone, is_demo)
    values (900010, 100, true)
  on conflict do nothing;

  -- 11. A few days of attendance. `code` is included alongside `status` since the
  --     live attendance UI reads `code` (FK'd to attendance_codes) for the register
  --     select and the "today so far" badges, not just the broader `status`.
  if array_length(v_periods, 1) >= 1 then
    insert into attendance (student_id, attend_date, period_number, status, code, staff_id, is_demo)
      select student_id, current_date - 1, v_periods[1], 'present', '/', 900001, true
      from students where is_demo = true and student_id between 900001 and 900013
    on conflict (student_id, attend_date, period_number) do nothing;
    insert into attendance (student_id, attend_date, period_number, status, code, staff_id, is_demo) values
      (900014, current_date - 1, v_periods[1], 'late', 'L', 900001, true),
      (900015, current_date - 1, v_periods[1], 'authorized_absence', 'I', 900001, true)
    on conflict (student_id, attend_date, period_number) do nothing;
  end if;
end;
$$;
