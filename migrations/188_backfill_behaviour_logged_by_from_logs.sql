-- 188_backfill_behaviour_logged_by_from_logs.sql
-- Applied to live on 23 Sep 2026, between 145 and 147. It was written as 146,
-- but 146_no_future_dated_registers.sql took that number first, so it is
-- recorded here under the next free number. Already applied: don't re-run.
-- Until migration 138, behaviour_events.staff_id ("logged by") was never set,
-- so events 81-925 (21-22 Sep) recorded no teacher. The principal asked for
-- it to be recovered from Supabase's API request logs, which still held every
-- behaviour save from 21-23 Sep with the logged-in user and the request size.
--
-- How the mapping was derived (not a guess from timestamps): the old form
-- sent a fixed JSON shape per row, so each event's exact byte size can be
-- rebuilt (using original values for rows edited or deleted since — the
-- Good work/Excellent work blanks, the 10 corrected points, and the rows
-- removed in 137/139). Walking the 101 successful POSTs of 21-22 Sep in order
-- against events in id order, every POST matched a contiguous run of events
-- byte-for-byte with nothing skipped. The only id gaps (148-155, 421) are
-- exactly the 9 rows of three POSTs RLS refused (student logins), and the
-- only POSTs with typed-in points are the ones holding the 10 events later
-- corrected in 141 — both independent confirmations.
--
-- Also derives class_id (so parents see the subject, migration 145) for
-- these events, the same way the insert trigger does: the one class that
-- teacher teaches that student, non-Mentor first, else left null.
--
-- behaviour_events_category_required (143) is NOT VALID and 26 of these rows
-- still have no category, so any update to them fails the check. It is
-- dropped for this one update and re-added exactly as before.

alter table behaviour_events drop constraint if exists behaviour_events_category_required;

update behaviour_events e
set staff_id = m.staff_id
from (values
  (81, 81, 134),
  (82, 96, 130),
  (97, 97, 116),
  (98, 101, 116),
  (102, 111, 107),
  (112, 113, 128),
  (114, 114, 130),
  (115, 123, 150),
  (124, 126, 107),
  (127, 141, 107),
  (142, 143, 107),
  (144, 145, 107),
  (146, 146, 107),
  (147, 147, 107),
  (156, 161, 114),
  (162, 162, 121),
  (163, 177, 121),
  (178, 187, 128),
  (188, 194, 115),
  (195, 195, 146),
  (196, 206, 104),
  (207, 217, 104),
  (218, 220, 130),
  (221, 223, 130),
  (224, 229, 125),
  (230, 237, 140),
  (238, 243, 119),
  (244, 244, 127),
  (245, 255, 111),
  (256, 256, 146),
  (257, 268, 126),
  (269, 280, 126),
  (281, 288, 150),
  (289, 299, 126),
  (300, 312, 105),
  (313, 313, 146),
  (314, 329, 121),
  (330, 330, 119),
  (331, 343, 119),
  (344, 348, 108),
  (349, 358, 115),
  (359, 364, 111),
  (365, 370, 115),
  (371, 372, 115),
  (373, 382, 111),
  (383, 394, 111),
  (395, 395, 115),
  (396, 410, 115),
  (411, 419, 115),
  (420, 420, 115),
  (422, 425, 150),
  (426, 426, 134),
  (427, 450, 144),
  (451, 474, 144),
  (475, 498, 144),
  (499, 558, 122),
  (559, 564, 140),
  (565, 573, 138),
  (574, 593, 155),
  (594, 601, 114),
  (602, 616, 144),
  (617, 617, 144),
  (618, 618, 144),
  (619, 628, 140),
  (629, 629, 106),
  (630, 642, 144),
  (643, 650, 128),
  (651, 665, 128),
  (666, 680, 133),
  (681, 694, 133),
  (695, 696, 152),
  (697, 700, 111),
  (701, 704, 111),
  (705, 708, 111),
  (709, 720, 111),
  (721, 737, 104),
  (738, 743, 108),
  (744, 753, 111),
  (754, 763, 111),
  (764, 775, 111),
  (776, 780, 111),
  (781, 785, 111),
  (786, 789, 116),
  (790, 797, 116),
  (798, 807, 115),
  (808, 811, 122),
  (812, 818, 115),
  (819, 834, 115),
  (835, 851, 115),
  (852, 855, 122),
  (856, 859, 115),
  (860, 876, 115),
  (877, 877, 155),
  (878, 878, 155),
  (879, 901, 149),
  (902, 906, 115),
  (907, 908, 115),
  (909, 909, 116),
  (910, 912, 116),
  (913, 913, 107),
  (914, 925, 107)
) m(first_id, last_id, staff_id)
where e.event_id between m.first_id and m.last_id
  and e.staff_id is null;

update behaviour_events e
set class_id = coalesce(
  (select min(c.class_id) from classes c
     join student_class sc on sc.class_id = c.class_id
     left join curriculum_blocks cb on cb.block_id = c.block_id
   where c.staff_id = e.staff_id and sc.student_id = e.student_id
     and cb.block_name is distinct from 'Mentor'
   having count(*) = 1),
  (select min(c.class_id) from classes c
     join student_class sc on sc.class_id = c.class_id
     join curriculum_blocks cb on cb.block_id = c.block_id
   where c.staff_id = e.staff_id and sc.student_id = e.student_id
     and cb.block_name = 'Mentor'
     and not exists (
       select 1 from classes c2
       join student_class sc2 on sc2.class_id = c2.class_id
       left join curriculum_blocks cb2 on cb2.block_id = c2.block_id
       where c2.staff_id = e.staff_id and sc2.student_id = e.student_id
         and cb2.block_name is distinct from 'Mentor')
   having count(*) = 1))
where e.event_id between 81 and 925
  and e.class_id is null
  and e.staff_id is not null;

alter table behaviour_events
  add constraint behaviour_events_category_required
  check (category is not null and length(trim(category)) > 0) not valid;
