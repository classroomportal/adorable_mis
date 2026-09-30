// The academic year a date falls in, and the one the school is in now.
//
// academic_years (migration 256) runs 1 September to 31 August, so a date's
// year can be worked out from the date alone. That also covers the years
// before 2026/27 that have no academic_years row (the historic exam result
// sets go back to 2017). The current year comes from the table when it has
// one marked current, so the switch to 2027/28 moves it; otherwise from
// today's date in Lagos.
import { supabase } from './supabaseClient';
import { schoolToday } from './schoolTime';

export function academicYearOf(isoDate) {
  if (!isoDate) return null;
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export async function loadCurrentAcademicYearLabel() {
  const { data } = await supabase.from('academic_years').select('label').eq('status', 'current').maybeSingle();
  return data?.label || academicYearOf(schoolToday());
}

// Result-set dropdowns (the principal's request, 30 Sept 2026): first date
// at the top, last at the bottom, within each school year. This school year
// comes first so its sets aren't buried under the historic exams (back to
// 2017); earlier years follow, most recent year first. Each group is
// { year: '2026/27', current: true|false, sets: [...] }.
export function groupBySchoolYear(sets, dateField = 'event_date') {
  const current = academicYearOf(schoolToday());
  const groups = [];
  for (const s of [...sets].sort((a, b) => String(a[dateField]).localeCompare(String(b[dateField])))) {
    const year = academicYearOf(s[dateField]);
    let g = groups.find((x) => x.year === year);
    if (!g) { g = { year, current: year === current, sets: [] }; groups.push(g); }
    g.sets.push(s);
  }
  return groups.sort((a, b) => (a.current ? -1 : b.current ? 1 : b.year.localeCompare(a.year)));
}

export function schoolYearGroupLabel(g) {
  return g.current ? `This school year (${g.year})` : g.year;
}
