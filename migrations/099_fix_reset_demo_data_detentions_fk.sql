-- Migration 099: reset_demo_data() must clear detentions before behaviour_events
--
-- A trigger auto-creates a `detentions` row (FK'd to behaviour_event_id) for
-- qualifying negative behaviour_events — including the seeded demo ones.
-- reset_demo_data() never deleted from detentions, so every run after the
-- first hit a FK violation deleting behaviour_events and aborted entirely
-- (the whole function is one transaction, so nothing else in it applied
-- either). Since the nightly cron (migration 080) has been calling this
-- unattended since it was scheduled, the demo dataset has likely been stuck
-- un-reset for a long time — this was only just discovered by hand while
-- re-enabling staff_demo.

create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
as $function$
declare
  v_maths_subject_id integer;
  v_english_subject_id integer;
  v_periods int[];
  v_result_event_id integer;
  v_result_event_date date;
  v_sat date;
begin
  delete from detentions where is_demo = true;
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

  select subject_id into v_maths_subject_id from subjects where subject_name ilike '%math%' limit 1;
  select subject_id into v_english_subject_id from subjects where subject_name ilike '%english%' limit 1;
  select array_agg(period_number order by period_number) into v_periods
    from (select period_number from periods order by period_number limit 4) t;
  select event_id, event_date into v_result_event_id, v_result_event_date
    from calendar_events where is_result_set = true order by event_date desc limit 1;

  v_sat := current_date - ((extract(dow from current_date)::int - 6 + 7) % 7);

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

  if v_maths_subject_id is not null and array_length(v_periods, 1) >= 2 then
    insert into timetable_slots (class_id, day_of_week, period_number, start_time, end_time, is_demo) values
      (900001, 'Mon', v_periods[1], '08:55', '09:45', true),
      (900001, 'Wed', v_periods[2], '10:45', '11:35', true);
  end if;
  if v_english_subject_id is not null and array_length(v_periods, 1) >= 4 then
    insert into timetable_slots (class_id, day_of_week, period_number, start_time, end_time, is_demo) values
      (900002, 'Tue', v_periods[3], '09:45', '10:35', true),
      (900002, 'Thu', v_periods[4], '13:15', '14:05', true);
  end if;

  if v_maths_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900001, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;
  if v_english_subject_id is not null then
    insert into student_class (student_id, class_id, is_demo)
      select student_id, 900002, true from students where is_demo = true and student_id between 900001 and 900015;
  end if;

  if v_maths_subject_id is not null and v_result_event_id is not null then
    insert into results (student_id, subject_id, result_set_event_id, week_start_date, score, max_score, grade, staff_id, result_type, is_demo) values
      (900001, v_maths_subject_id, v_result_event_id, v_result_event_date, 88, 100, 'A',  900001, 'exam_grade', true),
      (900002, v_maths_subject_id, v_result_event_id, v_result_event_date, 95, 100, 'A*', 900001, 'exam_grade', true),
      (900003, v_maths_subject_id, v_result_event_id, v_result_event_date, 72, 100, 'B',  900001, 'exam_grade', true),
      (900004, v_maths_subject_id, v_result_event_id, v_result_event_date, 58, 100, 'D',  900001, 'exam_grade', true),
      (900005, v_maths_subject_id, v_result_event_id, v_result_event_date, 91, 100, 'A*', 900001, 'exam_grade', true),
      (900006, v_maths_subject_id, v_result_event_id, v_result_event_date, 66, 100, 'C',  900001, 'exam_grade', true),
      (900007, v_maths_subject_id, v_result_event_id, v_result_event_date, 45, 100, 'E',  900001, 'exam_grade', true),
      (900008, v_maths_subject_id, v_result_event_id, v_result_event_date, 79, 100, 'B',  900001, 'exam_grade', true)
    on conflict (student_id, subject_id, result_set_event_id) do nothing;
  end if;

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

  insert into behaviour_events (student_id, staff_id, event_date, type, category, points, description, is_demo) values
    (900002, 900001, v_sat + 2, 'positive', 'Excellent work',  3,  'Outstanding maths homework.', true),
    (900005, 900001, v_sat + 3, 'positive', 'Helping others',  2,  null, true),
    (900010, 900001, v_sat + 4, 'positive', 'Kindness',        2,  null, true),
    (900007, 900001, v_sat + 1, 'negative', 'Late to lesson',        -1, 'Arrived 10 minutes late.', true),
    (900007, 900001, v_sat + 2, 'negative', 'Disruption in class',   -2, null, true),
    (900007, 900001, v_sat + 3, 'negative', 'Mobile phone misuse',   -2, 'Phone out during the lesson.', true),
    (900007, 900001, v_sat + 4, 'negative', 'Rudeness/disrespect',   -3, null, true),
    (900007, 900001, v_sat + 4, 'negative', 'Truancy',               -3, 'Missed period 3 without a note.', true),
    (900008, 900001, v_sat + 2, 'negative', 'Physical altercation',  -5, 'Pushed another student in the corridor.', true),
    (900009, 900001, v_sat + 3, 'positive', 'Leadership', 110, 'Cumulative term contribution recognised in one training seed row.', true)
  on conflict do nothing;

  insert into behaviour_appeals (event_id, student_id, reason, is_demo)
    select event_id, 900008, 'I was defending myself after being pushed first — please review the corridor camera footage.', true
    from behaviour_events
    where student_id = 900008 and category = 'Physical altercation' and is_demo = true
    order by event_id desc limit 1;

  insert into certificates_awarded (student_id, milestone, is_demo)
    values (900010, 100, true)
  on conflict do nothing;

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
$function$;
