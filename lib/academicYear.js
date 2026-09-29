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
