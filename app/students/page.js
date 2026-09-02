'use client';
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function StudentsList() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [formFilter, setFormFilter] = useState('');

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('student_summary')
        .select('*')
        .order('last_name', { ascending: true });
      if (error) setError(error.message);
      else setStudents(data);
      setLoading(false);
    }
    load();
  }, []);

  const years = useMemo(() => [...new Set(students.map((s) => s.year_group))].sort(), [students]);
  const forms = useMemo(() => [...new Set(students.map((s) => s.form_class))].sort(), [students]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const nameMatch = `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase());
      const yearMatch = !yearFilter || String(s.year_group) === yearFilter;
      const formMatch = !formFilter || s.form_class === formFilter;
      return nameMatch && yearMatch && formMatch;
    });
  }, [students, search, yearFilter, formFilter]);

  if (loading) return <p>Loading students...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h1>Students</h1>
      <p><a href="/students/import">→ Bulk import students from CSV</a> &nbsp;|&nbsp; <a href="/assessments/import">→ Import CAT4/NGRT predictive data</a></p>

      <form onSubmit={(e) => e.preventDefault()}>
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
      </form>

      <p style={{ color: '#5a6b8c', fontSize: '0.9rem' }}>{filtered.length} of {students.length} students</p>

      <div className="table-scroll"><table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Year</th>
            <th>Form</th>
            <th>Net Behaviour</th>
            <th>Latest Avg %</th>
            <th>Primary Contact</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s) => (
            <tr key={s.student_id} className="student-link" onClick={() => window.location.href = `/students/${s.student_id}`}>
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
    </div>
  );
}

export default function Page() {
  return <RequireAuth><StudentsList /></RequireAuth>;
}
