'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function ResultsPageInner() {
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [relps, setRelps] = useState([]);
  const [results, setResults] = useState([]);
  const [form, setForm] = useState({
    student_id: '', subject_id: '', week_start_date: '', score: '', max_score: '', grade: '',
  });
  const [status, setStatus] = useState(null);

  async function loadResults() {
    const { data } = await supabase
      .from('results')
      .select('result_id, week_start_date, score, max_score, grade, students(first_name,last_name), subjects(subject_name)')
      .order('week_start_date', { ascending: false })
      .limit(20);
    setResults(data || []);
  }

  useEffect(() => {
    async function loadOptions() {
      const { data: s } = await supabase.from('students').select('student_id, first_name, last_name').order('last_name');
      const { data: sub } = await supabase.from('subjects').select('subject_id, subject_name').order('subject_name');
      setStudents(s || []);
      setSubjects(sub || []);
      const { data: rl } = await supabase.from('calendar_events').select('event_id, event_date, event_name').eq('category', 'relp').order('event_date', { ascending: false });
      setRelps(rl || []);
    }
    loadOptions();
    loadResults();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('Saving...');
    const { error } = await supabase.from('results').insert([{
      student_id: form.student_id,
      subject_id: form.subject_id,
      week_start_date: form.week_start_date,
      score: form.score || null,
      max_score: form.max_score || null,
      grade: form.grade || null,
    }]);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus('Saved.');
      setForm({ student_id: '', subject_id: '', week_start_date: '', score: '', max_score: '', grade: '' });
      loadResults();
    }
  }

  return (
    <div>
      <h1>Weekly Results</h1>
      <p><a href="/results/import">→ Bulk import results from CSV</a></p>

      <form onSubmit={handleSubmit}>
        <label>
          Student
          <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} required>
            <option value="">Select...</option>
            {students.map((s) => (
              <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
            ))}
          </select>
        </label>

        <label>
          Subject
          <select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} required>
            <option value="">Select...</option>
            {subjects.map((s) => (
              <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>
            ))}
          </select>
        </label>

        <label>
          ReLP (test)
          <select
            value={form.week_start_date}
            onChange={(e) => setForm({ ...form, week_start_date: e.target.value })}
          >
            <option value="">Select a ReLP, or type a custom date below...</option>
            {relps.map((r) => (
              <option key={r.event_id} value={r.event_date}>{r.event_name} — {r.event_date}</option>
            ))}
          </select>
        </label>

        <label>
          Or custom date
          <input type="date" value={form.week_start_date} onChange={(e) => setForm({ ...form, week_start_date: e.target.value })} />
        </label>

        <label>
          Score
          <input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
        </label>

        <label>
          Max score
          <input type="number" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
        </label>

        <label>
          Grade
          <input type="text" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
        </label>

        <button type="submit">Add result</button>
      </form>

      {status && <p>{status}</p>}

      <h2>Recent results</h2>
      <div className="table-scroll"><table>
        <thead>
          <tr><th>Week</th><th>Student</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.result_id}>
              <td>{r.week_start_date}</td>
              <td>{r.students?.first_name} {r.students?.last_name}</td>
              <td>{r.subjects?.subject_name}</td>
              <td>{r.score ?? '—'}{r.max_score ? ` / ${r.max_score}` : ''}</td>
              <td>{r.grade ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function ResultsPage() {
  return <RequireAuth><ResultsPageInner /></RequireAuth>;
}
