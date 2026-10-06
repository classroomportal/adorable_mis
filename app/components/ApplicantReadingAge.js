'use client';
import { formatUKDate } from '../../lib/formatDate';
import { ageInMonths, formatMonths } from '../../lib/admissions';
import { monthsFromParts, formatGap } from '../../lib/readingAge';
import { schoolToday } from '../../lib/schoolTime';

// The reading age taken when a child applies (migration 379): years and
// months, the date tested and the test used. Shared by the New application
// form and the applicant's Details. `value` holds the boxes as typed:
// { reading_years, reading_months, reading_tested_on, reading_test_name }.

export const EMPTY_READING = { reading_years: '', reading_months: '', reading_tested_on: '', reading_test_name: '' };

export function readingFromApplicant(a) {
  return a?.reading_age_months != null
    ? {
      reading_years: String(Math.floor(a.reading_age_months / 12)),
      reading_months: String(a.reading_age_months % 12),
      reading_tested_on: a.reading_tested_on || '',
      reading_test_name: a.reading_test_name || '',
    }
    : { ...EMPTY_READING };
}

// The columns to save, or { error } when the boxes don't make a reading.
export function readingToRow(v) {
  if (v.reading_years === '' && v.reading_months === '') {
    return { reading_age_months: null, reading_tested_on: null, reading_test_name: null };
  }
  const months = monthsFromParts(v.reading_years, v.reading_months);
  if (months == null) return { error: 'Reading age: whole years from 3 to 20, and months from 0 to 11.' };
  if (!v.reading_tested_on) return { error: 'Give the date the reading age was tested.' };
  if (v.reading_tested_on > schoolToday()) return { error: "A reading age can't be dated after today." };
  return {
    reading_age_months: months,
    reading_tested_on: v.reading_tested_on,
    reading_test_name: v.reading_test_name.trim() || null,
  };
}

export default function ApplicantReadingAgeFields({ value, onChange, dob }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const months = monthsFromParts(value.reading_years, value.reading_months);
  const age = dob && value.reading_tested_on ? ageInMonths(dob, value.reading_tested_on) : null;
  const today = schoolToday();
  return (
    <div className="form-grid">
      <label>
        Reading age: years
        <input type="number" min="3" max="20" step="1" inputMode="numeric" value={value.reading_years}
          onChange={(e) => set({ reading_years: e.target.value, reading_tested_on: value.reading_tested_on || today })} />
      </label>
      <label>
        Months
        <input type="number" min="0" max="11" step="1" inputMode="numeric" value={value.reading_months}
          onChange={(e) => set({ reading_months: e.target.value, reading_tested_on: value.reading_tested_on || today })} />
      </label>
      <label>
        Date tested
        <input type="date" max={today} value={value.reading_tested_on} onChange={(e) => set({ reading_tested_on: e.target.value })} />
        {value.reading_tested_on && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(value.reading_tested_on)}</span>}
      </label>
      <label>Reading test used<input value={value.reading_test_name} onChange={(e) => set({ reading_test_name: e.target.value })} /></label>
      {months != null && (
        <p style={{ margin: 0, fontSize: '0.9em', alignSelf: 'end' }}>
          Reading age <strong>{formatMonths(months)}</strong>
          {age != null && <>; age then {formatMonths(age)}; difference{' '}
            <strong style={{ color: months - age < 0 ? '#a3232c' : '#1a7a3d' }}>{formatGap(months - age)}</strong></>}
        </p>
      )}
    </div>
  );
}
