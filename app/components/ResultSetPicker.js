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

// A result-set picker in place of a native <select>. On iPad, Safari draws a
// <select>'s options in a narrow popover that CSS can't widen, so names like
// "New students check — 5 Oct 2026" wrapped onto two lines. This list is as
// wide as the field and keeps every entry on one line.
//
// Result sets dated today or earlier come first, most recent at the top; ones
// still to come sit underneath under "Upcoming", soonest first.
export default function ResultSetPicker({ resultSets, value, onChange }) {
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
          {selected ? `${selected.event_name} — ${formatUKDate(selected.event_date)}` : 'Select a result set...'}
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
