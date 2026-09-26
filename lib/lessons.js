import { supabase } from './supabaseClient';

// A lesson (timetable_slots row) can have its own teacher and room, set only
// where Nova-T gives that one lesson someone or somewhere other than the
// rest of the class — 8A1/Hu is LEE's class, but one of its two lessons is
// VAE's (migration 182). NULL means "the class's"; a room of '' means the
// lesson has no room (Nova-T leaves it blank). Everything that shows who
// teaches a lesson, or where, goes through these rather than reading the
// class's teacher/room straight off.

// Columns to embed for a lesson, wherever timetable_slots is selected.
export const LESSON_COLUMNS = 'slot_id, day_of_week, period_number, start_time, end_time, staff_id, room, staff(first_name, last_name)';

export function lessonRoom(slot, cls) {
  if (slot?.room != null) return slot.room || null;
  return cls?.room || null;
}

// Display name of whoever teaches this lesson, or null.
export function lessonTeacher(slot, cls) {
  const s = slot?.staff_id ? slot.staff : cls?.staff;
  return s ? `${s.first_name} ${s.last_name}` : null;
}

// One member of staff's classes, each carrying only the lessons that are
// theirs: their own classes' lessons minus any given to someone else, plus
// single lessons of other people's classes that are given to them. Same
// shape as a classes select with timetable_slots embedded.
export async function loadStaffLessons(staffId) {
  const classCols = 'class_id, room, class_code, staff_id, subjects(subject_name, display_name)';
  const [{ data: own, error: ownErr }, { data: given, error: givenErr }] = await Promise.all([
    supabase.from('classes').select(`${classCols}, timetable_slots(${LESSON_COLUMNS})`).eq('staff_id', staffId),
    supabase.from('timetable_slots').select(`${LESSON_COLUMNS}, classes!inner(${classCols})`).eq('staff_id', staffId),
  ]);
  const error = ownErr || givenErr || null;
  const byClass = new Map();
  for (const c of own || []) {
    byClass.set(c.class_id, {
      ...c,
      timetable_slots: (c.timetable_slots || []).filter((t) => !t.staff_id || t.staff_id === staffId),
    });
  }
  for (const t of given || []) {
    const { classes: c, ...slot } = t;
    if (!byClass.has(c.class_id)) byClass.set(c.class_id, { ...c, timetable_slots: [] });
    const entry = byClass.get(c.class_id);
    if (!entry.timetable_slots.some((x) => x.slot_id === slot.slot_id)) entry.timetable_slots.push(slot);
  }
  return { classes: [...byClass.values()], error };
}
