'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { classifyAverage, isWaecGrade, STYLE, LABEL } from '../../../lib/gradeCompare';
import { formatUKDate } from '../../../lib/formatDate';

function gradeScaleOf(grade) {
  return isWaecGrade(grade) ? 'waec' : 'igcse';
}

// Which results count as belonging to a chosen result set.
//
// Scores entered on /results/enter carry result_set_event_id. Scores written
// by /results/import-gradebook do not — they are keyed on the week alone — so
// a result set also claims untagged rows from its own date, which is how
// /results/subject-overview already reads them. Without that, picking "T3
// Exam" would show an empty table, since every result imported so far is
// untagged.
function belongsToResultSet(r, ev) {
  return r.result_set_event_id === ev.event_id
    || (r.result_set_event_id == null && r.week_start_date === ev.event_date);
}

// One grade per student+subject: the chosen result set's, or the most recent
// if no result set is chosen. Now that a week can hold more than one result
// set, "most recent" ties on week_start_date are broken by result_id, so the
// later-entered score wins rather than whichever row arrived first.
function pickGrades(results, chosenSet) {
  const picked = {};
  (results || []).forEach((r) => {
    if (!r.grade) return;
    if (chosenSet && !belongsToResultSet(r, chosenSet)) return;
    const key = `${r.student_id}-${r.subject_id}`;
    const prev = picked[key];
    if (!prev) { picked[key] = r; return; }
    if (chosenSet) {
      // Within one result set, a row actually tagged with it beats a row
      // matched only on its date.
      if (r.result_set_event_id != null && prev.result_set_event_id == null) picked[key] = r;
      return;
    }
    if (r.week_start_date > prev.week_start_date) picked[key] = r;
    else if (r.week_start_date === prev.week_start_date && r.result_id > prev.result_id) picked[key] = r;
  });
  return picked;
}

function buildRows(data, chosenSet) {
  if (!data) return [];
  const { classes, sc, students, targets, results, gs, subjMeta, departmentScope } = data;

  const departmentBySubject = Object.fromEntries((subjMeta || []).map((s) => [s.subject_id, s.department_name]));

  const displayName = {};
  const fallbackFor = {};
  (subjMeta || []).forEach((s) => {
    displayName[s.subject_id] = s.display_name || s.subject_name;
    if (s.target_fallback_subject_id) fallbackFor[s.subject_id] = s.target_fallback_subject_id;
  });

  const points = Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)]));
  const activeStudentIds = new Set((students || []).map((s) => s.student_id));
  const yearByStudent = Object.fromEntries((students || []).map((s) => [s.student_id, s.year_group]));

  const gradeByKey = pickGrades(results, chosenSet);
  const targetByKey = Object.fromEntries((targets || []).map((t) => [`${t.student_id}-${t.subject_id}`, t.target_grade]));

  const studentsByClass = {};
  (sc || []).forEach((row) => {
    if (!activeStudentIds.has(row.student_id)) return;
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
      // A target set against the subject itself wins over the mapped one.
      // Mapping Civics at Sociology says where to read a target when Civics
      // has none, not that the 60 Civics targets already recorded should be
      // passed over.
      const key = `${sid}-${c.subject_id}`;
      const fallbackSubjectId = fallbackFor[c.subject_id];
      const target = targetByKey[key]
        ?? (fallbackSubjectId ? targetByKey[`${sid}-${fallbackSubjectId}`] : undefined);
      const latest = gradeByKey[key];
      if (!target || !latest?.grade) return;
      const targetGrade = target;
      const actualGrade = latest.grade.trim().toUpperCase();
      if (gradeScaleOf(targetGrade) !== gradeScaleOf(actualGrade)) return; // different grading systems — not comparable
      const tp = points[targetGrade];
      const ap = points[actualGrade];
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
  return out;
}

function ClassProgressInner() {
  const [data, setData] = useState(null);
  const [resultSets, setResultSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [resultSetFilter, setResultSetFilter] = useState(''); // '' = most recent result
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
      const [classes, sc, students, targets, results, gs, subjMeta, myScope, sets] = await Promise.all([
        fetchAll('classes', 'class_id, class_code, subject_id, staff_id, subjects(subject_name), staff(first_name, last_name)', (q) => q.not('subject_id', 'is', null)),
        fetchAll('student_class', 'student_id, class_id'),
        fetchAll('students', 'student_id, year_group', (q) => q.eq('status', 'active')),
        fetchAll('target_grades', 'student_id, subject_id, target_grade'),
        fetchAll('results', 'result_id, student_id, subject_id, grade, week_start_date, result_set_event_id'),
        fetchAll('grade_scale', '*'),
        fetchAll('subjects', 'subject_id, subject_name, display_name, target_fallback_subject_id, department_name'),
        supabase.rpc('my_department_scope'),
        supabase.from('calendar_events').select('event_id, event_name, event_date').eq('is_result_set', true).order('event_date', { ascending: false }),
      ]);
      // NULL means unscoped (admin, assessment_manager, etc.) — see everything,
      // same as today. A non-null value means the viewer is a Head of
      // Department scoped to that department, so Class Progress narrows to
      // subjects in that department only, across ALL teachers — not just
      // their own classes.
      const departmentScope = myScope?.data || null;
      setScopedDepartment(departmentScope);
      setResultSets(sets?.data || []);
      setData({ classes, sc, students, targets, results, gs, subjMeta, departmentScope });
      setLoading(false);
    }
    load();
  }, []);

  const chosenSet = resultSets.find((e) => String(e.event_id) === String(resultSetFilter)) || null;
  const rows = useMemo(() => buildRows(data, chosenSet), [data, chosenSet]);

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
      <p>Each class's average grade vs the average target grade for the same students. Pick a result set to compare that set's scores, or leave it on Most recent result to use each student's latest score per subject. Classes with fewer than one comparable student are hidden. Target and actual grades are only compared when both are on the same grading scale (IGCSE or WAEC) — a Year 12 class whose result predates their WAEC track (e.g. still IGCSE-graded) won't show a comparison until a WAEC-scale result is entered. Sorted worst-to-best. (+ / ~ / - = Above / On / Below target)</p>

      <div className="card">
        <label>
          Result set
          <select value={resultSetFilter} onChange={(e) => setResultSetFilter(e.target.value)}>
            <option value="">Most recent result</option>
            {resultSets.map((e) => (
              <option key={e.event_id} value={e.event_id}>
                {e.event_name} — {formatUKDate(e.event_date)}
              </option>
            ))}
          </select>
        </label>
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
              const cls = classifyAverage(r.diff);
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
      {!loading && filtered.length === 0 && (
        <p>
          {chosenSet
            ? `No classes have comparable target + result data for ${chosenSet.event_name}.`
            : 'No classes have comparable target + result data yet.'}
        </p>
      )}
    </div>
  );
}

export default function ClassProgressPage() {
  return <RequireAuth><RequireResource resourceKey="/classes/progress"><ClassProgressInner /></RequireResource></RequireAuth>;
}
