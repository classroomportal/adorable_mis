-- Migration 147: Lesson 1 starts at 09:00, not 08:20.
--
-- Registers Not Done listed Wednesday's Lesson 1 registers (11w/Fr1, 11w/Fr2,
-- 11w/Sp1, 11w/Ng1, 9A1/Pe, 9G1/Pe) as "started 08:20", which is wrong: on
-- Monday to Thursday, Lesson 1 (period_number 2) runs 09:00–09:50, after the
-- 08:00–08:55 morning registration. 60 of the 82 Mon–Thu Lesson 1 slots
-- already had 09:00. The other 22 still had 08:20–09:10, a bell time left over
-- from an older timetable. That made those registers show as outstanding 40
-- minutes before the lesson began, and put the wrong time on staff timetables.
--
-- Friday has its own shorter day (Lesson 1 at 08:30) and is left alone.
-- Registers are keyed on period_number, not time, so no attendance rows move.
--
-- The same old bell times also appear in a few other periods (10:20, 11:10,
-- 13:00, 13:50 starts). This migration leaves those alone until the school
-- confirms the correct times for them.

update timetable_slots
   set start_time = '09:00',
       end_time   = '09:50'
 where period_number = 2
   and day_of_week in ('Mon', 'Tue', 'Wed', 'Thu')
   and start_time = '08:20';
