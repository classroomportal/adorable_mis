import { supabase } from './supabaseClient';

// The week columns of a term, shared by the Termly Grade Report, the
// gradebook importer's week picker and the report writer's "Wk3" labels so
// all three number weeks the same way.
//
// A week is 7 days from the term's start date. A week with no school day in
// it (every Monday to Friday inside the term is a `holiday` calendar event,
// e.g. the mid-term break, or the term only reaches it on a weekend) isn't a
// teaching week: it gets no column and doesn't take a number, so a term of
// five weeks, half term and five weeks reads Wk1–Wk10 (the principal,
// 9 Oct 2026; it used to print Wk1–Wk11 with an empty half-term column).

const DAY = 24 * 60 * 60 * 1000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// Every `holiday` date between from and to, as a Set of 'YYYY-MM-DD'.
export async function loadHolidayDates(from, to) {
  const { data } = await supabase
    .from('calendar_events')
    .select('event_date')
    .eq('category', 'holiday')
    .gte('event_date', from)
    .lte('event_date', to);
  return new Set((data || []).map((e) => e.event_date));
}

function hasSchoolDay(weekStart, termEnd, holidays) {
  for (let i = 0; i < 7; i += 1) {
    const t = weekStart + i * DAY;
    if (t > termEnd) break;
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5 && !holidays.has(iso(t))) return true;
  }
  return false;
}

// [{ label: 'Wk1', date: 'YYYY-MM-DD' }, ...] — `date` is the week's first
// day. Without holidays every week is a column, as before.
export function buildWeekColumns(term, holidays = new Set()) {
  const weeks = [];
  const end = new Date(`${term.end_date}T00:00:00Z`).getTime();
  let cursor = new Date(`${term.start_date}T00:00:00Z`).getTime();
  let n = 1;
  while (cursor <= end) {
    if (hasSchoolDay(cursor, end, holidays)) {
      weeks.push({ label: `Wk${n}`, date: iso(cursor) });
      n += 1;
    }
    cursor += 7 * DAY;
  }
  return weeks;
}
