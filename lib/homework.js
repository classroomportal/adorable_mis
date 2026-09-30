import { supabase } from './supabaseClient';
import { schoolToday } from './schoolTime';

// Homework (migration 278, docs/homework-design.md). Homework grades sit
// outside reporting: nothing here is read by reports, transcripts or result
// sets. What a student may see is decided in the database by my_homework(),
// which returns the signed-in student's own homework and, once the teacher has
// released them, their own marks for the current academic year only.

export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const OUTCOMES = ['Not handed in', 'Excused'];

// Date arithmetic on YYYY-MM-DD strings, done at UTC midnight so the device's
// timezone can't shift a day.
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayKey(iso) {
  return DAY_KEYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
}

export function weekStartOf(iso) {
  return addDays(iso, -DAY_KEYS.indexOf(dayKey(iso)));
}

// The week a student most likely wants: this one, or next week at the weekend.
export function defaultWeekStart() {
  const today = schoolToday();
  const k = dayKey(today);
  return k === 'Sat' || k === 'Sun' ? addDays(weekStartOf(today), 7) : weekStartOf(today);
}

// "Tue 6 Oct"
export function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${dayKey(iso)} ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

export async function loadMyHomework(from, to) {
  const { data, error } = await supabase.rpc('my_homework', { p_from: from, p_to: to });
  return { homework: data || [], error };
}

// A mark as shown to a student or teacher: "14/20", "72%", "B", "Not handed in".
export function markLabel(hw) {
  if (hw.grade) return hw.grade;
  if (hw.score === null || hw.score === undefined) return null;
  const score = Number(hw.score);
  if (hw.scheme_name === 'Percentage') return `${score}%`;
  return hw.out_of ? `${score}/${Number(hw.out_of)}` : String(score);
}

// Due / Overdue / Not handed in / Excused / Graded, for a homework returned by
// my_homework() (which only includes a mark once released).
export function homeworkStatus(hw, today = schoolToday()) {
  if (hw.marked) {
    if (OUTCOMES.includes(hw.grade)) return { key: hw.grade === 'Excused' ? 'excused' : 'missing', label: hw.grade };
    return { key: 'graded', label: `Graded: ${markLabel(hw)}` };
  }
  if (hw.due_on < today) return { key: 'overdue', label: 'Overdue' };
  return { key: 'due', label: 'Due' };
}

// Attach each homework to the timetable cell of the lesson it's due in. The
// cellMap entries must carry classId. Homework with no lesson goes in the
// class's first lesson that day; if the class has no lesson that day it is
// returned in `unplaced[day]` for a strip under that day's heading.
export function placeHomeworkInCells(cellMap, homework, periods) {
  const unplaced = {};
  const periodOrder = (periods || []).map((p) => p.period_number);
  for (const hw of homework) {
    const day = dayKey(hw.due_on);
    let target = null;
    if (hw.due_period != null) {
      target = (cellMap[`${day}-${hw.due_period}`] || []).find((e) => e.classId === hw.class_id);
    }
    if (!target) {
      for (const p of periodOrder) {
        target = (cellMap[`${day}-${p}`] || []).find((e) => e.classId === hw.class_id);
        if (target) break;
      }
    }
    if (target) target.homework = [...(target.homework || []), hw];
    else unplaced[day] = [...(unplaced[day] || []), hw];
  }
  return unplaced;
}

// { 'YYYY-MM-DD': [homework…] } for each day of the week starting weekStart.
export function groupHomeworkByDay(homework, weekStart) {
  const byDay = {};
  for (let i = 0; i < 7; i += 1) byDay[addDays(weekStart, i)] = [];
  for (const hw of homework) if (byDay[hw.due_on]) byDay[hw.due_on].push(hw);
  return byDay;
}

// Instructions are plain text. Only https links become links; nothing else
// is rendered as markup.
export function linkifyParts(text) {
  if (!text) return [];
  return text.split(/(https:\/\/[^\s<>"]+)/g).map((part, i) => ({
    text: part,
    isLink: i % 2 === 1,
  }));
}
