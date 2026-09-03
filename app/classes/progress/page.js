'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';

const STYLE = {
  above: { background: '#dcf5e3', color: '#1a7a3d' },
  on: { background: '#fdecad', color: '#8a6d00' },
  below: { background: '#fbdede', color: '#a3232c' },
};
const LABEL = { above: 'Above target', on: 'On target', below: 'Below target' };

function classify(diff) {
  if (diff > 0.15) return 'above';
  if (diff < -0.15) return 'below';
  return 'on';
}

function ClassProgressInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  useEffect(() => {
    async function load() {
      const [{ data: classes }, { data: sc }, { data: students }, { data: targets }, { data: results }, { data: gs }] = await Promise.all([
        supabase.from('classes').select('class_id, class_code, subject_id, subjects(subject_name)').not('subject_id', 'is', null),
        supabase.from('student_class').select('student_id, class_id'),
        supabase.from('students').select('student_id, year_group'),
        supabase.from('target_grades').select('student_id, subject_id, target_grade'),
        supabase.from('results').select('student_id, subject_id, grade, week_start_date'),
        supabase.from('grade_scale').select('*'),
      ]);

      const points = Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)]));
      const yearByStudent = Object.fromEntries((students || []).map((s) => [s.student_id, s.year_group]));

      // most recent grade per student+subject
      const latestGrade = {};
      (results || []).forEach((r) => {
        const key = `${r.student_id}-${r.subject_id}`;
        if (!r.grade) return;
        if (!latestGrade[key] || r.week_start_date > latestGrade[key].week_start_date) {
          latestGrade[key] = r;
        }
      });
      const targetByKey = Object.fromEntries((targets || []).map((t) => [`${t.student_id}-${t.subject_id}`, t.target_grade]));

      const studentsByClass = {};
      (sc || []).forEach((row) => {
        if (!studentsByClass[row.class_id]) studentsByClass[row.class_id] = [];
        studentsByClass[row.class_id].push(row.student_id);
      });

      const out = [];
      (classes || []).forEach((c) => {
        const roster = studentsByClass[c.class_id] || [];
        let targetSum = 0, actualSum = 0, n = 0, above = 0, on = 0, below = 0;
        let yearGuess = null;
        roster.forEach((sid) => {
          yearGuess = yearGuess ?? yearByStudent[sid];
          const key = `${sid}-${c.subject_id}`;
          const target = targetByKey[key];
          const latest = latestGrade[key];
          if (!target || !latest?.grade) return;
          const tp = points[target];
          const ap = points[latest.grade.trim().toUpperCase()];
          if (tp === undefined || ap === undefined) return;
          targetSum += tp; actualSum += ap; n += 1;
          const c2 = ap > tp ? 'above' : ap < tp ? 'below' : 'on';
          if (c2 === 'above') above += 1; else if (c2 === 'below') below += 1; else on += 1;
        });
        if (n === 0) return; // no comparable data yet for this class
        const avgTarget = targetSum / n;
        const avgActual = actualSum / n;
        out.push({
          class_id: c.class_id,
          class_code: c.class_code,
          subject: c.subjects?.subject_name,
          year: yearGuess,
          n, above, on, below,
          avgTarget, avgActual,
          diff: avgActual - avgTarget,
        });
      });

      out.sort((a, b) => a.diff - b.diff); // worst-performing classes first
      setRows(out);
      setLoading(false);
    }
    load();
  }, []);

  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].filter(Boolean).sort((a, b) => a - b), [rows]);
  const subjects = useMemo(() => [...new Set(rows.map((r) => r.subject))].filter(Boolean).sort(), [rows]);

  const filtered = rows.filter((r) =>
    (!yearFilter || String(r.year) === yearFilter) &&
    (!subjectFilter || r.subject === subjectFilter)
  );

  return (
    <div>
      <h1>Class Progress</h1>
      <p>Each class's average grade vs the average target grade for the same students, most recent result per subject. Classes with fewer than one comparable student are hidden. Sorted worst-to-best.</p>

      <div className="card">
        <label>
          Year group
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Subject
          <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
            <option value="">All</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="table-scroll"><table>
          <thead>
            <tr><th>Class</th><th>Subject</th><th>Year</th><th>Students compared</th><th>Above / On / Below</th><th>Overall</th></tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cls = classify(r.diff);
              return (
                <tr key={r.class_id}>
                  <td>{r.class_code}</td>
                  <td>{r.subject}</td>
                  <td>{r.year}</td>
                  <td>{r.n}</td>
                  <td>{r.above} / {r.on} / {r.below}</td>
                  <td><span className="badge" style={STYLE[cls]}>{LABEL[cls]}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {!loading && filtered.length === 0 && <p>No classes have comparable target + result data yet.</p>}
    </div>
  );
}

export default function ClassProgressPage() {
  return <RequireAuth><ClassProgressInner /></RequireAuth>;
}
