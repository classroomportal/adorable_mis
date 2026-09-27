'use client';
import { useEffect, useRef, useState } from 'react';
import { formatUKDate } from '../../lib/formatDate';

// Today's date as YYYY-MM-DD in the device's own time zone, so it compares
// directly with calendar_events.event_date.
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whole days from today to an ISO date: negative = in the past.
export function daysFromToday(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [ty, tm, td] = localToday().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

export function describeDistance(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// First day of the current school year, taken as 1 August: the school runs
// September to July, so "T3 Exam — 19 Jul 2026" is last year's.
export function schoolYearStart() {
  const [y, m] = localToday().split('-').map(Number);
  return `${m >= 8 ? y : y - 1}-08-01`;
}

// Result sets from an earlier school year are there to look at (Subject
// Overview, student and class progress), not to enter marks against, so
// the pages that save marks leave them out of their pickers.
export function currentYearSets(resultSets) {
  const start = schoolYearStart();
  return resultSets.filter((r) => r.event_date >= start);
}

// A result set dated more than this many days ago asks "are you sure?" before
// marks are entered against it. Anything dated in the future always does.
const STALE_AFTER_DAYS = 14;

// Why this result set's date looks wrong for entering marks today, or null.
export function dateWarning(resultSet) {
  const days = daysFromToday(resultSet.event_date);
  const when = `${formatUKDate(resultSet.event_date, { weekday: true })}, ${describeDistance(days)}`;
  if (days > 0) return `"${resultSet.event_name}" is dated ${when} — it hasn't happened yet.`;
  if (days < -STALE_AFTER_DAYS) return `"${resultSet.event_name}" is dated ${when}.`;
  return null;
}

// For pages that save marks: asks before choosing a set whose date looks
// wrong. Returns false if the user backs out.
export function confirmResultSetDate(resultSet) {
  const warning = resultSet && dateWarning(resultSet);
  return !warning || confirm(`${warning}\n\nAre you sure this is the result set you want?`);
}

// The line under a picker: the chosen set's date and how far off it is, in
// red when checkDate is on and the date looks wrong for entering marks.
export function ResultSetDateNote({ resultSet, checkDate = false }) {
  if (!resultSet) return null;
  const warning = checkDate ? dateWarning(resultSet) : null;
  return (
    <span style={{ color: warning ? 'var(--red-700)' : 'var(--ink-soft)' }}>
      {warning || `Dated ${formatUKDate(resultSet.event_date, { weekday: true })}, ${describeDistance(daysFromToday(resultSet.event_date))}.`}
    </span>
  );
}

// Field wrapper matching the app's <label> look. A div, not a <label>: a
// label would route every tap inside the open list back to the toggle button.
export const fieldStyle = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem', color: 'var(--ink-soft)', flex: '1 1 140px' };

// A result-set picker in place of a native <select>. On iPad, Safari draws a
// <select>'s options in a narrow popover that CSS can't widen, so names like
// "New students check — 5 Oct 2026" wrapped onto two lines. This list is as
// wide as the field and keeps every entry on one line.
//
// Result sets dated today or earlier come first, most recent at the top; ones
// still to come sit underneath under "Upcoming", soonest first.
export default function ResultSetPicker({ resultSets, value, onChange, placeholder = 'Select a result set...' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = localToday();
  const pastAndToday = resultSets.filter((r) => r.event_date <= today)
    .sort((a, b) => b.event_date.localeCompare(a.event_date));
  const upcoming = resultSets.filter((r) => r.event_date > today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const selected = resultSets.find((r) => String(r.event_id) === String(value));

  function pick(id) {
    setOpen(false);
    onChange(String(id));
  }

  const rowStyle = (isSelected) => ({
    display: 'flex', alignItems: 'baseline', gap: '0.75rem', width: '100%', textAlign: 'left',
    whiteSpace: 'nowrap', overflow: 'hidden', borderRadius: 6, padding: '0.55rem 0.65rem',
    background: isSelected ? 'var(--brand-100)' : 'white', color: 'var(--ink)', fontWeight: isSelected ? 600 : 400,
  });
  const dateStyle = { color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums', minWidth: '6.5rem', flexShrink: 0 };
  const headingStyle = { fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-soft)', padding: '0.5rem 0.65rem 0.25rem' };

  const renderRow = (r) => (
    <button
      key={r.event_id}
      type="button"
      role="option"
      aria-selected={String(r.event_id) === String(value)}
      onClick={() => pick(r.event_id)}
      style={rowStyle(String(r.event_id) === String(value))}
    >
      <span style={dateStyle}>{formatUKDate(r.event_date)}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.event_name}</span>
    </button>
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'white', color: 'var(--ink)', fontWeight: 400,
          border: '1px solid var(--slate-200)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? `${selected.event_name} — ${formatUKDate(selected.event_date)}` : placeholder}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--ink-soft)' }}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'white', border: '1px solid var(--slate-200)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '0.25rem', maxHeight: '60vh', overflowY: 'auto',
          }}
        >
          {resultSets.length === 0 && <div style={headingStyle}>No result sets yet</div>}
          {pastAndToday.map(renderRow)}
          {upcoming.length > 0 && (
            <>
              <div style={headingStyle}>Upcoming</div>
              {upcoming.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
