// Reading ages (migration 323). Every reading age a student has (the
// admissions interview, the school's own tests, NGRT) comes from
// reading_age_history(), which also works out the child's age on the day
// and the gap: reading age minus age, in months, negative when reading
// below their age. Nothing here recalculates those; it only shows them.

import { supabase } from './supabaseClient';

export const SOURCE_LABEL = {
  interview: 'Admissions interview',
  school: 'School test',
  ngrt: 'NGRT',
};

// "11 y 4 m", as on the admissions page.
export function formatMonths(months) {
  if (months == null) return '';
  return `${Math.floor(months / 12)} y ${months % 12} m`;
}

// "+8 m", "−1 y 2 m", "0".
export function formatGap(months) {
  if (months == null) return '—';
  if (months === 0) return '0';
  const sign = months < 0 ? '−' : '+';
  const abs = Math.abs(months);
  return abs < 12 ? `${sign}${abs} m` : `${sign}${formatMonths(abs)}`;
}

// Bands for the gap, worst first. A starting point for the page's colours
// and counts, not a school rule.
export const GAP_BANDS = [
  { key: 'well_below', label: '2+ years below', test: (g) => g <= -24, style: { background: '#fbdede', color: '#a3232c' } },
  { key: 'below', label: '1–2 years below', test: (g) => g <= -12 && g > -24, style: { background: '#ffe6cc', color: '#8a4b00' } },
  { key: 'slightly_below', label: 'Up to 1 year below', test: (g) => g < 0 && g > -12, style: { background: '#fff4cc', color: '#7a5a00' } },
  { key: 'at_or_above', label: 'At or above their age', test: (g) => g >= 0, style: { background: '#dcf5e3', color: '#1a7a3d' } },
];

export function gapBand(gap) {
  if (gap == null) return null;
  return GAP_BANDS.find((b) => b.test(gap)) || null;
}

// Change in the gap: positive means the gap closed (or the lead grew).
export function formatChange(months) {
  if (months == null) return '—';
  if (months === 0) return 'no change';
  const abs = Math.abs(months);
  const amount = abs < 12 ? `${abs} m` : formatMonths(abs);
  return months > 0 ? `▲ ${amount}` : `▼ ${amount}`;
}

export function changeColour(months) {
  if (months == null || months === 0) return '#555';
  return months > 0 ? '#1a7a3d' : '#a3232c';
}

// Years and months typed into two boxes, as months, or null if not valid.
export function monthsFromParts(years, months) {
  if (years === '' || years == null) return null;
  const y = Number(years);
  const m = months === '' || months == null ? 0 : Number(months);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 0 || m > 11) return null;
  const total = y * 12 + m;
  return total >= 36 && total <= 240 ? total : null;
}

// Every reading for the given students (all students if none given), oldest
// first, grouped by student_id.
export async function loadReadingAgeHistory(studentIds) {
  const { data, error } = await supabase.rpc('reading_age_history', {
    p_student_ids: studentIds && studentIds.length ? studentIds : null,
  });
  if (error) return { byStudent: {}, error: error.message };
  const byStudent = {};
  for (const r of data || []) (byStudent[r.student_id] ||= []).push(r);
  return { byStudent, error: null };
}

// First, latest and the change in the gap between them, for one student's
// readings (oldest first).
export function summariseReadings(readings) {
  if (!readings || readings.length === 0) return null;
  const first = readings[0];
  const latest = readings[readings.length - 1];
  const change = readings.length > 1 && first.gap_months != null && latest.gap_months != null
    ? latest.gap_months - first.gap_months : null;
  const previous = readings.length > 1 ? readings[readings.length - 2] : null;
  const sinceLast = previous && previous.gap_months != null && latest.gap_months != null
    ? latest.gap_months - previous.gap_months : null;
  return { first, latest, previous, change, sinceLast, count: readings.length };
}
