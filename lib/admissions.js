// Shared helpers for the admissions pages (migration 256).
//
// The database decides every status change (book_admission_test(),
// post_admission_decision() and the bursar's functions); the labels and
// allowed moves below only decide which buttons a page shows. Keep
// NEXT_STEPS in step with v_allowed in post_admission_decision().
import { supabase } from './supabaseClient';

export const STATUS_ORDER = [
  'enquiry', 'form_paid', 'test_booked', 'tested', 'invited_to_interview',
  'interviewed', 'waitlisted', 'offered', 'accepted', 'deposit_paid',
  'enrolled', 'rejected', 'withdrawn',
];

export const STATUS_LABELS = {
  enquiry: 'Enquiry',
  form_paid: 'Form paid',
  test_booked: 'Test booked',
  tested: 'Tested',
  invited_to_interview: 'Invited to interview',
  interviewed: 'Interviewed',
  waitlisted: 'Waiting list',
  rejected: 'Unsuccessful',
  offered: 'Offered',
  accepted: 'Accepted',
  deposit_paid: 'Deposit paid',
  enrolled: 'Enrolled',
  withdrawn: 'Withdrawn',
};

// What an admissions officer can move an applicant to from each status.
// Paying the form and the deposit are the bursar's; booking a test is done
// with the test-day picker, not a status button.
export const NEXT_STEPS = {
  enquiry: ['withdrawn'],
  form_paid: ['withdrawn'],
  test_booked: ['tested', 'withdrawn'],
  tested: ['invited_to_interview', 'waitlisted', 'rejected', 'withdrawn'],
  invited_to_interview: ['interviewed', 'rejected', 'withdrawn'],
  interviewed: ['offered', 'waitlisted', 'rejected', 'withdrawn'],
  waitlisted: ['invited_to_interview', 'offered', 'rejected', 'withdrawn'],
  offered: ['accepted', 'withdrawn'],
  accepted: ['withdrawn'],
  deposit_paid: ['withdrawn'],
  enrolled: [],
  rejected: [],
  withdrawn: [],
};

// Button wording for each move.
export const STEP_ACTIONS = {
  tested: 'Mark as tested',
  invited_to_interview: 'Invite to interview',
  interviewed: 'Mark as interviewed',
  waitlisted: 'Put on waiting list',
  rejected: 'Unsuccessful',
  offered: 'Offer a place',
  accepted: 'Family accepted',
  withdrawn: 'Withdraw',
};

// Moves that send the family one of the standard letters.
export const STEPS_WITH_LETTERS = new Set(['invited_to_interview', 'waitlisted', 'rejected', 'offered']);

export const LETTER_KIND_LABELS = {
  test_date: 'Test date',
  invite_to_interview: 'Invitation to interview',
  waitlist_after_test: 'Waiting list (after the test)',
  reject_after_test: 'Unsuccessful (after the test)',
  offer: 'Offer of a place',
  waitlist_after_interview: 'Waiting list (after the interview)',
  reject_after_interview: 'Unsuccessful (after the interview)',
};

// The merge fields render_admission_letter() fills in.
export const MERGE_FIELDS = [
  ['child_first_name', "The child's first (or preferred) name"],
  ['child_full_name', "The child's full name"],
  ['parent_name', 'The main contact'],
  ['entry_year', 'Entry year, e.g. 2027/28'],
  ['year_group', 'e.g. Year 7'],
  ['test_date', 'The booked test day'],
  ['test_time', 'Its start time'],
  ['test_venue', 'Its venue'],
  ['interview_date', 'The interview date'],
  ['interview_time', 'The interview time'],
  ['form_fee', 'The admission form fee'],
  ['deposit', 'The deposit'],
  ['today', "Today's date"],
];

// The fixed list of interests collected at interview, so they can be counted
// and later offered to the Other Half coordinator. "Other" is free text.
export const INTERESTS = [
  'Football', 'Basketball', 'Athletics', 'Swimming', 'Tennis', 'Other sport',
  'Music (instrument)', 'Singing / choir', 'Drama', 'Dance', 'Art & design',
  'Debating / public speaking', 'Writing', 'Reading', 'Coding / computing',
  'Science & STEM clubs', 'Chess', 'Cooking', 'Community service',
];

export const CURRICULA = ['British', 'Nigerian', 'American', 'IB', 'Other'];
export const YEAR_GROUPS = [7, 8, 9, 10, 11, 12];

export function statusBadgeStyle(status) {
  if (['rejected', 'withdrawn'].includes(status)) return { background: '#fbdede', color: '#a3232c' };
  if (['offered', 'accepted', 'deposit_paid', 'enrolled'].includes(status)) return { background: '#dcf5e3', color: '#1a7a3d' };
  if (status === 'waitlisted') return { background: '#fff1cc', color: '#7a5a00' };
  return { background: '#e6eefb', color: '#1d4a8f' };
}

export function applicantName(a) {
  if (!a) return '';
  const first = a.preferred_name && a.preferred_name !== a.first_name
    ? `${a.first_name} (${a.preferred_name})` : a.first_name;
  return `${first} ${a.last_name}`;
}

// Reading age is stored in months; shown as "11 y 4 m".
export function formatMonths(months) {
  if (months == null) return '';
  return `${Math.floor(months / 12)} y ${months % 12} m`;
}

// Age in whole months on a given day, from a date of birth.
export function ageInMonths(dob, onDate) {
  if (!dob || !onDate) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let months = (y - by) * 12 + (m - bm);
  if (d < bd) months -= 1;
  return months;
}

export function formatMoney(n) {
  if (n == null || n === '') return '';
  return `₦${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The academic years, with the year admissions is normally working on
// (the first 'planning' year, else the current one) picked out.
export async function loadAcademicYears() {
  const { data } = await supabase.from('academic_years').select('*').order('start_date');
  const years = data || [];
  const defaultYear = years.find((y) => y.status === 'planning') || years.find((y) => y.status === 'current') || years[0];
  return { years, defaultYearId: defaultYear?.academic_year_id ?? null };
}

// Supabase/Postgres errors raised by the admissions functions are written
// for staff to read; show them as they are.
export function errorText(error) {
  return error?.message || String(error || 'Something went wrong.');
}
