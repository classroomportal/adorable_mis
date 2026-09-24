// Shared helpers for the HR staff record (/staff/records). The data lives in
// staff_hr_profiles, staff_training, staff_warnings and
// staff_attendance_records (migration 134), readable by HR and SMT only.
import { schoolToday } from './schoolTime';

export const EMPLOYMENT_TYPES = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  temporary: 'Temporary',
  volunteer: 'Volunteer',
};

// HR's departments — deliberately not the `departments` table, which holds
// academic departments for Head of Department scoping and has no home for
// support staff. Stored as the label itself.
export const HR_DEPARTMENTS = Object.fromEntries(
  ['Maths', 'Science', 'Languages', 'Creative', 'Pastoral', 'Administration', 'Humanities'].map((d) => [d, d])
);

// Matches the check constraint on staff_hr_profiles.nationality (migration 164).
export const NATIONALITIES = { Nigerian: 'Nigerian', British: 'British', Other: 'Other' };

export const WARNING_LEVELS = {
  verbal: 'Verbal',
  written: 'Written',
  final_written: 'Final written',
  other: 'Other',
};

export const ATTENDANCE_TYPES = {
  late: 'Late arrival',
  sick: 'Sick',
  annual_leave: 'Annual leave',
  authorised_absence: 'Authorised absence',
  unauthorised_absence: 'Unauthorised absence',
  other: 'Other',
};

// How close to its renewal date a police clearance starts showing as due.
const CLEARANCE_WARNING_DAYS = 60;

// The UK academic year runs September–August; the school counts days off and
// lateness against the current one.
export function academicYearStart(today = schoolToday()) {
  const [y, m] = today.split('-').map(Number);
  return `${m >= 9 ? y : y - 1}-09-01`;
}

export function academicYearLabel(today = schoolToday()) {
  const start = Number(academicYearStart(today).slice(0, 4));
  return `${start}/${String(start + 1).slice(2)}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00`) - new Date(`${fromIso}T00:00:00`)) / 86400000);
}

// { tone: 'ok' | 'warn' | 'bad', label } for a police clearance. No date on
// file is treated as a problem, not a blank — a school must hold one.
export function clearanceStatus(hr, today = schoolToday()) {
  if (!hr?.police_clearance_date) return { tone: 'bad', label: 'Not recorded' };
  const renewal = hr.police_clearance_renewal_date;
  if (!renewal) return { tone: 'ok', label: 'On file' };
  const left = daysBetween(today, renewal);
  if (left < 0) return { tone: 'bad', label: 'Expired' };
  if (left <= CLEARANCE_WARNING_DAYS) return { tone: 'warn', label: `Renewal due in ${left} day${left === 1 ? '' : 's'}` };
  return { tone: 'ok', label: 'Valid' };
}

// "4 yrs 3 mths" of service since an appointment date.
export function lengthOfService(appointedIso, today = schoolToday()) {
  if (!appointedIso) return '';
  const [ay, am, ad] = appointedIso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - ay) * 12 + (tm - am) - (td < ad ? 1 : 0);
  if (months < 0) return 'Starts in the future';
  const years = Math.floor(months / 12);
  months %= 12;
  const parts = [];
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (months || !years) parts.push(`${months} mth${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

// A warning is live until its expiry date; with no expiry it never lapses.
export function isWarningLive(w, today = schoolToday()) {
  return !w.expires_on || w.expires_on >= today;
}

export function isTrainingExpired(t, today = schoolToday()) {
  return !!t.expires_on && t.expires_on < today;
}

// Days off and lateness for the current academic year.
export function attendanceTotals(records, today = schoolToday()) {
  const from = academicYearStart(today);
  const thisYear = records.filter((r) => r.start_date >= from && r.start_date <= today);
  const late = thisYear.filter((r) => r.record_type === 'late');
  const off = thisYear.filter((r) => r.record_type !== 'late');
  const sum = (rows) => rows.reduce((n, r) => n + Number(r.days ?? 1), 0);
  return {
    daysOff: sum(off),
    annualLeaveTaken: sum(off.filter((r) => r.record_type === 'annual_leave')),
    sickDays: sum(off.filter((r) => r.record_type === 'sick')),
    timesLate: late.length,
    minutesLate: late.reduce((n, r) => n + (r.minutes_late || 0), 0),
  };
}

export function initials(s) {
  return `${(s?.first_name || '').trim().charAt(0)}${(s?.last_name || '').trim().charAt(0)}`.toUpperCase();
}
