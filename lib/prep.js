// Evening prep and homework time (migration 352). The database decides
// whether a homework fits (homework_prep_time_check()); these helpers only
// show the numbers.

function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// Homework time on one prep evening: prep's length less the fixed activity.
export function prepEveningMinutes(row) {
  if (!row) return 0;
  return toMinutes(row.prep_ends) - toMinutes(row.prep_starts) - (Number(row.fixed_minutes) || 0);
}

// "1 h 15 min", "45 min", "2 h".
export function minutesLabel(mins) {
  const n = Math.round(Number(mins) || 0);
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const HOMEWORK_MINUTE_CHOICES = [15, 20, 30, 45, 60, 75, 90];

// The prep evening a deadline puts a class's homework on (the evening
// before; the database decides), and the room the class has left then:
// { prep_on, students, least_free, students_short }, prep_on null if there
// is no prep evening in the week before the deadline.
export async function loadPrepCheck(supabase, classId, dueOn, minutes, homeworkId = null) {
  if (!classId || !dueOn) return { check: null, error: null };
  const { data, error } = await supabase.rpc('homework_prep_check', {
    p_class_id: classId, p_due_on: dueOn, p_minutes: Number(minutes) || 0, p_homework_id: homeworkId,
  });
  return { check: data?.[0] || null, error };
}
