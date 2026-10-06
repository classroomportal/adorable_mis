// The Other Half: the activity programme in the OH slot (migration 156).
// Activities live in other_half_* tables, not classes/timetable_slots, so a
// Nova-T import can't overwrite them.
import { supabase } from './supabaseClient';

export const OH_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const OH_DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

// Nova-T's code for the old whole-year OH groups (7a/Oh1 ...). The importer
// skips these, and a timetable shows a student's chosen activity in their place.
export const OH_SUBJECT_CODE = 'oh';

export function isOtherHalfSubject(subject) {
  return (subject?.subject_code || '').toLowerCase() === OH_SUBJECT_CODE;
}

// "Years 7, 8, 9" / "Year 12".
export function formatYearGroups(years) {
  const ys = [...(years || [])].sort((a, b) => a - b);
  if (ys.length === 0) return '—';
  return `${ys.length === 1 ? 'Year' : 'Years'} ${ys.join(', ')}`;
}

// The OH period, and which weekdays actually have one (from Bell Times).
// Found by short label, never by number — period_number is offset from the
// lesson number.
export async function loadOtherHalfSlots() {
  const { data } = await supabase
    .from('school_day')
    .select('day_of_week, period_number, period_name, start_time, end_time')
    .eq('short_label', 'OH');
  const rows = data || [];
  const byDay = Object.fromEntries(rows.map((r) => [r.day_of_week, r]));
  return {
    periodNumber: rows[0]?.period_number ?? null,
    periodName: rows[0]?.period_name || 'The Other Half',
    byDay,
    days: OH_DAYS.filter((d) => byDay[d]),
  };
}

// Supabase caps an unranged select at 1000 rows; a term's choices can pass
// that (≈280 students × 5 days), so page through.
export async function fetchAll(buildQuery) {
  const pageSize = 1000;
  let all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) return all;
  }
}

export async function loadCurrentOtherHalfTermId() {
  const { data } = await supabase.rpc('current_other_half_term');
  return data ?? null;
}

// Staff names per activity: { [activity_id]: [{staff_id, first_name, last_name}] }.
export function staffByActivity(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r.staff) continue;
    (out[r.activity_id] ||= []).push(r.staff);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.last_name.localeCompare(b.last_name));
  return out;
}

export function staffNames(list) {
  return (list || []).map((s) => `${s.first_name} ${s.last_name}`).join(', ');
}

// Put a student's chosen activities (other_half_timetable rows) into a
// timetable cellMap of arrays keyed "Day-period", replacing the old
// whole-year Nova-T OH class in that slot. Entries built from classes must
// carry isOtherHalfClass for that to work.
export function mergeOtherHalfIntoCells(cellMap, rows, makeEntry) {
  for (const r of rows || []) {
    if (!r.period_number) continue;
    const key = `${r.day_of_week}-${r.period_number}`;
    const kept = (cellMap[key] || []).filter((e) => !e.isOtherHalfClass);
    cellMap[key] = [...kept, makeEntry(r)];
  }
  return cellMap;
}

// Which days each year group has the Other Half (migrations 384, 386), as
// { [year_group]: ['Mon', ...] }. A year with no row may use any day. Edited
// at /other-half/year-days; the database refuses activities, choices and
// Nova-T lessons that break it.
export async function loadOtherHalfYearDays() {
  const { data } = await supabase.from('other_half_year_days').select('year_group, days, reason, updated_at');
  return Object.fromEntries((data || []).map((r) => [r.year_group, r.days || []]));
}

export function yearHasOtherHalfOn(yearDays, year, day) {
  const days = yearDays?.[year];
  return !days || days.includes(day);
}
