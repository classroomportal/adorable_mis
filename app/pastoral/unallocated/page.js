'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Active students missing a boarding house, a boarding room, or a lesson in
// a period the rest of their year group has (lessons, Evening Prep, The
// Other Half), from unallocated_students() (migration 320).

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'house', label: 'No boarding house' },
  { key: 'room', label: 'No room' },
  { key: 'timetable', label: 'Timetable gaps' },
];

function UnallocatedInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [year, setYear] = useState('');

  useEffect(() => {
    supabase.rpc('unallocated_students').then(({ data, error }) => {
      if (error) setError(error.message);
      setRows(data || []);
      setLoading(false);
    });
  }, []);

  const counts = useMemo(() => ({
    all: rows.length,
    house: rows.filter((r) => r.no_house).length,
    room: rows.filter((r) => r.no_room).length,
    timetable: rows.filter((r) => r.timetable_gaps?.length).length,
  }), [rows]);

  const years = useMemo(() => [...new Set(rows.map((r) => r.year_group))].sort((a, b) => a - b), [rows]);

  const shown = rows.filter((r) => {
    if (year && String(r.year_group) !== year) return false;
    if (filter === 'house') return r.no_house;
    if (filter === 'room') return r.no_room;
    if (filter === 'timetable') return r.timetable_gaps?.length > 0;
    return true;
  });

  return (
    <div>
      <h1>Unallocated Students</h1>
      <p>
        Students still at the school who have no boarding house, no boarding room, or an empty
        slot in their week. A slot only counts as empty when others in the same year group have
        something then: a lesson, Evening Prep, or (this term) an Other Half activity open to
        their year. Click a name to open the student and fix it.
      </p>

      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? undefined : 'secondary'}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year group">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
        </div>

        {loading ? <p>Loading...</p> : error ? <p style={{ color: '#a3232c' }}>{error}</p> : shown.length === 0 ? (
          <p>Nobody to show: every student here has a house, a room and a full week.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Year / Form</th>
                <th>Boarding house</th>
                <th>Room</th>
                <th>Timetable gaps</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.student_id}>
                  <td><a href={`/students/${r.student_id}`}>{r.first_name} {r.last_name}</a></td>
                  <td style={{ whiteSpace: 'nowrap' }}>Year {r.year_group}{r.form_class ? ` · ${r.form_class}` : ''}</td>
                  <td>{r.no_house ? <strong style={{ color: '#a3232c' }}>None</strong> : r.boarding_house}</td>
                  <td>{r.no_room ? <strong style={{ color: '#a3232c' }}>None</strong> : r.boarding_room_number}</td>
                  <td>{r.timetable_gaps?.length ? r.timetable_gaps.join(', ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p style={{ color: '#5b6472', fontSize: '0.85rem', marginTop: 12 }}>
          M = registration, L1–L6 = lessons, OH = The Other Half, EP = Evening Prep.
        </p>
      </div>
    </div>
  );
}

export default function UnallocatedPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/unallocated"><UnallocatedInner /></RequireResource></RequireAuth>;
}
