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
  const [scopedDepartment, setScopedDepartment] = useState(null);

  useEffect(() => {
    // Supabase caps unpaginated selects at 1000 rows. Several of these
    // tables exceed that (student_class alone is 4000+), so page through
    // all rows rather than risk silently truncated data.
    async function fetchAll(table, columns, filterFn) {
      const PAGE = 1000;
      let from = 0;
      let all = [];
      while (true) {
        let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
        if (filterFn) q = filterFn(q);
        const { data, error } = await q;
        if (error) { console.error(`fetchAll ${table}:`, error.message); break; }
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    }

    async function load() {
      const [classes, sc, students, targets, results, gs, subjMeta, myScope] = await Promise.all([
        fetchAll('classes', 'class_id, class_code, subject_id, staff_id, subjects(subject_name), staff(first_name, last_name)', (q) => q.not('subject_id', 'is', null)),
        fetchAll('student_class', 'student_id, class_id'),
        fetchAll('students', 'student_id, year_group'),
        fetchAll('target_grades', 'student_id, subject_id, target_grade'),
        fetchAll('results', 'student_id, subject_id, grade, week_start_date'),
        fetchAll('grade_scale', '*'),
        fetchAll('subjects', 'subject_id, subject_name, display_name, target_fallback_subject_id, department_name'),
        supabase.rpc('my_department_scope'),
      ]);
      // NULL means unscoped (admin, assessment_manager, etc.) — see everything,
      // same as today. A non-null value means the viewer is a Head of
      // Department scoped to that department, so Class Progress narrows to
      // subjects in that department only, across ALL teachers — not just
      // their own classes.
      const departmentScope = myScope?.data || null;
      setScopedDepartment(departmentScope);
      const departmentBySubject = Object.fromEntries((subjMeta || []).map((s) => [s.subject_id, s.department_name]));

      const displayName = {};
      const fallbackFor = {};
      (subjMeta || []).forEach((s) => {
        displayName[s.subject_id] = s.display_name || s.subject_name;
        if (s.target_fallback_subject_id) fallbackFor[s.subject_id] = s.target_fallback_subject_id;
      });

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
      (classes || [])
        .filter((c) => !departmentScope || departmentBySubject[c.subject_id] === departmentScope)
        .forEach((c) => {
        const roster = studentsByClass[c.class_id] || [];
        let targetSum = 0, actualSum = 0, n = 0, above = 0, on = 0, below = 0;
        let yearGuess = null;
        roster.forEach((sid) => {
          yearGuess = yearGuess ?? yearByStudent[sid];
          const targetSubjectId = fallbackFor[c.subject_id] || c.subject_id;
          const key = `${sid}-${c.subject_id}`;
          const targetKey = `${sid}-${targetSubjectId}`;
          const target = targetByKey[targetKey];
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
          subject: displayName[c.subject_id] || c.subjects?.subject_name,
          teacher: c.staff ? `${c.staff.first_name} ${c.staff.last_name}` : '—',
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
      {scopedDepartment && (
        <p style={{ color: '#e34430', fontWeight: 600 }}>
          Showing {scopedDepartment} department classes only (Head of Department view)
        </p>
      )}
      <p>Each class's average grade vs the average target grade for the same students, most recent result per subject. Classes with fewer than one comparable student are hidden. Sorted worst-to-best. (+ / ~ / - = Above / On / Below target)</p>

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
            <tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Year</th><th>Students<br />Compared</th><th>+ / ~ / -</th><th>Overall</th></tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cls = classify(r.diff);
              return (
                <tr key={r.class_id}>
                  <td>{r.class_code}</td>
                  <td>{r.subject}</td>
                  <td>{r.teacher}</td>
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
