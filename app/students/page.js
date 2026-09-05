'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function StudentsList() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const [years, setYears] = useState([]);
  const [forms, setForms] = useState([]);

  // On mount, only fetch the small distinct year/form lists needed to
  // populate the filter dropdowns — not the full student list or photos.
  useEffect(() => {
    async function loadFilterOptions() {
      const { data } = await supabase.from('student_summary').select('year_group, form_class');
      setYears([...new Set((data || []).map((s) => s.year_group))].sort());
      setForms([...new Set((data || []).map((s) => s.form_class))].filter(Boolean).sort());
    }
    loadFilterOptions();
  }, []);

  async function loadStudents() {
    setLoading(true);
    setError(null);
    let query = supabase.from('student_summary').select('*').order('last_name', { ascending: true });
    if (yearFilter) query = query.eq('year_group', Number(yearFilter));
    if (formFilter) query = query.eq('form_class', formFilter);
    if (search.trim()) query = query.or(`first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%`);

    const { data, error } = await query;
    if (error) { setError(error.message); setLoading(false); return; }

    // Only fetch photos for the students actually matching the filter,
    // not the whole school — this is what was making the page slow.
    const ids = (data || []).map((s) => s.student_id);
    let photoMap = {};
    if (ids.length > 0) {
      const { data: photos } = await supabase.from('students').select('student_id, photo_base64').in('student_id', ids);
      photoMap = Object.fromEntries((photos || []).filter((p) => p.photo_base64).map((p) => [p.student_id, p.photo_base64]));
    }
    setStudents((data || []).map((s) => ({ ...s, photo_base64: photoMap[s.student_id] })));
    setHasLoaded(true);
    setLoading(false);
  }

  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h1>Students</h1>
      <p><a href="/students/import">→ Bulk import students from CSV</a> &nbsp;|&nbsp; <a href="/assessments/import">→ Import CAT4/NGRT predictive data</a> &nbsp;|&nbsp; <a href="/parents/import">→ Import parents from CSV</a> &nbsp;|&nbsp; <a href="/students/photos/import">→ Import student photos</a></p>

      <form onSubmit={(e) => { e.preventDefault(); loadStudents(); }}>
        <label>
          Search name
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Wilson" />
        </label>
        <label>
          Year group
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Form class
          <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)}>
            <option value="">All</option>
            {forms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Loading...' : 'Load students'}</button>
      </form>

      {!hasLoaded && !loading && (
        <p style={{ color: '#5a6b8c' }}>Choose filters (or leave blank for everyone) and press Load students.</p>
      )}

      {hasLoaded && (
        <>
          <p style={{ color: '#5a6b8c', fontSize: '0.9rem' }}>{students.length} student(s) loaded</p>

          <div className="table-scroll"><table>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Year</th>
            <th>Form</th>
            <th>Net Behaviour</th>
            <th>Latest Avg %</th>
            <th>Primary Contact</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.student_id} className="student-link" onClick={() => window.location.href = `/students/${s.student_id}`}>
              <td>
                {s.photo_base64 ? (
                  <img src={`data:image/jpeg;base64,${s.photo_base64}`} alt="" style={{ width: 32, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                ) : (
                  <div style={{ width: 32, height: 40, borderRadius: 4, background: 'var(--slate-200)' }} />
                )}
              </td>
              <td>{s.first_name} {s.last_name}</td>
              <td>{s.year_group}</td>
              <td>{s.form_class}</td>
              <td>{s.net_behaviour_points}</td>
              <td>{s.latest_week_avg_pct ?? '—'}</td>
              <td>{s.primary_contact_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  return <RequireAuth><StudentsList /></RequireAuth>;
}
