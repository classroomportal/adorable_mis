'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { GENDER_FILTERS, EMPTY_STUDENT_FILTER } from '../../lib/medical';

// One filter bar, shared by every Clinic screen that works through a roster.
// The option lists come from the live student data rather than a hardcoded
// list, so a new form class or boarding house appears here on its own.
//
// Filtering itself happens client-side against an already-loaded roster
// (274 active students), which keeps the controls instant and means a
// screen can filter rows it has joined to other tables without rebuilding
// the query.

export function useStudentFilterOptions() {
  const [options, setOptions] = useState({ years: [], forms: [], houses: [] });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('students')
        .select('year_group, form_class, boarding_house')
        .eq('status', 'active');
      const uniq = (key) => Array.from(new Set((data || []).map((s) => s[key]).filter((v) => v !== null && v !== '')));
      setOptions({
        years: uniq('year_group').sort((a, b) => a - b),
        forms: uniq('form_class').sort(),
        houses: uniq('boarding_house').sort(),
      });
    })();
  }, []);

  return options;
}

export default function StudentFilterBar({
  filter, onChange, options, extra, resultCount, totalCount,
  onLoad, loading, dirty,
}) {
  const set = (patch) => onChange({ ...filter, ...patch });
  const active = Object.entries(filter).some(([, v]) => v !== '');

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ maxWidth: '9rem' }}>Year group
          <select value={filter.yearGroup} onChange={(e) => set({ yearGroup: e.target.value })}>
            <option value="">All</option>
            {options.years.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>

        <label style={{ maxWidth: '9rem' }}>Form class
          <select value={filter.formClass} onChange={(e) => set({ formClass: e.target.value })}>
            <option value="">All</option>
            {options.forms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        <label style={{ maxWidth: '9rem' }}>Gender
          <select value={filter.gender} onChange={(e) => set({ gender: e.target.value })}>
            {GENDER_FILTERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>

        <label style={{ maxWidth: '10rem' }}>Boarding house
          <select value={filter.house} onChange={(e) => set({ house: e.target.value })}>
            <option value="">All</option>
            {options.houses.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>

        <label style={{ maxWidth: '13rem' }}>Name
          <input placeholder="Search..." value={filter.name} onChange={(e) => set({ name: e.target.value })} />
        </label>

        {extra}

        {/* Load is the primary action when a screen has server-side filters:
            the ones above narrow rows already in the browser, but a date
            range or a search term has to go back to the database, and doing
            that on every keystroke is both slow and surprising. */}
        {onLoad && (
          <button type="button" onClick={onLoad} disabled={loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>
        )}

        {active && (
          <button type="button" className="secondary" onClick={() => onChange({ ...EMPTY_STUDENT_FILTER })}>Clear</button>
        )}
      </div>

      {dirty && (
        <p style={{ fontSize: '0.8rem', color: '#7a5a10', margin: '0.6rem 0 0', fontWeight: 600 }}>
          Filters changed — press Load to fetch them.
        </p>
      )}

      {resultCount !== undefined && (
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '0.6rem 0 0' }}>
          Showing <strong>{resultCount}</strong>{totalCount !== undefined && ` of ${totalCount}`}
          {/* 14 active students have no gender recorded, so a gender filter
              hides them rather than guessing which way they go. */}
          {filter.gender && filter.gender !== 'unknown' && ' — students with no gender on record are excluded'}
        </p>
      )}
    </div>
  );
}

// A student's photo at a consistent size, with a neutral placeholder for the
// 18 active students who have none — an empty gap reads as a loading bug.
export function StudentPhoto({ student, size = 56 }) {
  const initials = `${student?.first_name?.[0] || ''}${student?.last_name?.[0] || ''}`.toUpperCase();
  const style = {
    width: size, height: Math.round(size * 1.25), borderRadius: 6, objectFit: 'cover',
    flexShrink: 0, border: '1px solid var(--slate-200)', background: 'var(--slate-100)',
  };
  if (student?.photo_base64) {
    return <img src={`data:image/jpeg;base64,${student.photo_base64}`} alt="" style={style} />;
  }
  return (
    <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--ink-soft)', fontWeight: 700, fontSize: size * 0.32 }}>
      {initials || '—'}
    </div>
  );
}
