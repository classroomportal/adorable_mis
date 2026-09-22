// Shared vocabulary for the medical record (migration 128) — the option
// lists, the BMI-for-age bands and the small formatters used by both the
// per-student card on /students/[id] and the whole-school Clinic pages.
// Kept here so the two never drift apart: a value added to a CHECK
// constraint in SQL needs adding in exactly one place on this side.

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const GENOTYPES = ['AA', 'AS', 'SS', 'AC', 'SC', 'CC'];

export const CONDITION_KINDS = [
  { value: 'allergy', label: 'Allergy' },
  { value: 'condition', label: 'Condition' },
  { value: 'medication', label: 'Regular medication' },
  { value: 'dietary', label: 'Dietary' },
];

export const SEVERITIES = [
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'life_threatening', label: 'Life-threatening' },
];

export const VISIT_CATEGORIES = [
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'medication', label: 'Medication round' },
  { value: 'routine', label: 'Routine check' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'other', label: 'Other' },
];

export const VISIT_OUTCOMES = [
  { value: 'returned_to_class', label: 'Returned to class' },
  { value: 'rested_in_sick_bay', label: 'Rested in sick bay' },
  { value: 'sent_home', label: 'Sent home' },
  { value: 'referred_to_hospital', label: 'Referred to hospital' },
  { value: 'other', label: 'Other' },
];

// Look up a display label, falling back to the raw stored value rather than
// blanking it — an unrecognised value means the DB knows something this list
// doesn't, which is worth seeing rather than hiding.
export function labelFor(options, value) {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label || value;
}

// WHO BMI-for-age (5–19) reads the z-score, not the adult 18.5/25/30 bands,
// which are wrong for every student here (they are 9–18). A z-score only
// exists once bmi_for_age_reference has been loaded — until then the app
// shows the BMI number alone rather than inventing a category for a child.
export function bmiBand(z) {
  if (z === null || z === undefined) return null;
  if (z < -3) return { label: 'Severe thinness', tone: 'bad' };
  if (z < -2) return { label: 'Thinness', tone: 'bad' };
  if (z <= 1) return { label: 'Healthy weight', tone: 'good' };
  if (z <= 2) return { label: 'Overweight', tone: 'warn' };
  return { label: 'Obesity', tone: 'bad' };
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTimeOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Local calendar date as YYYY-MM-DD. Deliberately NOT
// toISOString().slice(0, 10), which gives the *UTC* date: the school runs on
// Africa/Lagos (UTC+1), so between midnight and 01:00 the UTC date is still
// yesterday and a visit recorded then would be filed under the wrong day.
// This is the browser-side counterpart of school_today() in Postgres.
export function isoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoToday() {
  return isoDate();
}

// Days either side of today, as a local calendar date.
export function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

// A timestamp's date in the reader's own timezone — again not
// iso.slice(0, 10), which would show the UTC day.
export function formatDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// <input type="datetime-local"> wants local wall-clock time, not UTC.
export function localDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function studentName(s) {
  if (!s) return 'Unknown student';
  return `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Unknown student';
}
