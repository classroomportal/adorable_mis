'use client';
import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Supabase caps unpaginated selects at 1000 rows and student_class is 4000+,
// so page through rather than read a silent slice.
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

function downloadCsv(rows, filename) {
  const blob = new Blob([Papa.unparse(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function CoverageInner() {
  const [gaps, setGaps] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [subjectsById, setSubjectsById] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [gapRows, students, subjects] = await Promise.all([
        fetchAll('target_grade_gaps', 'student_id, subject_id, read_target_from, student_has_no_targets_at_all'),
        fetchAll('students', 'student_id, first_name, last_name, year_group, upn', (q) => q.eq('status', 'active')),
        fetchAll('subjects', 'subject_id, subject_name, display_name, target_fallback_subject_id'),
      ]);
      setGaps(gapRows);
      setStudentsById(Object.fromEntries(students.map((s) => [s.student_id, s])));
      setSubjectsById(Object.fromEntries(subjects.map((s) => [s.subject_id, s])));
      setLoading(false);
    }
    load();
  }, []);

  const subjectName = (id) => subjectsById[id]?.display_name || subjectsById[id]?.subject_name || `Subject ${id}`;
  const studentName = (id) => {
    const s = studentsById[id];
    return s ? `${s.first_name} ${s.last_name}` : `Student ${id}`;
  };

  // Two different problems that need two different answers, so they are never
  // added together: a student with nothing at all needs a target set, while a
  // subject with no source needs a decision about the subject.
  const noTargetsAtAll = useMemo(() => {
    const ids = new Set(gaps.filter((g) => g.student_has_no_targets_at_all).map((g) => g.student_id));
    return [...ids]
      .map((id) => studentsById[id])
      .filter(Boolean)
      .sort((a, b) => (a.year_group - b.year_group) || a.last_name.localeCompare(b.last_name));
  }, [gaps, studentsById]);

  const subjectGaps = useMemo(() => gaps.filter((g) => !g.student_has_no_targets_at_all), [gaps]);

  const bySubject = useMemo(() => {
    const counts = {};
    subjectGaps.forEach((g) => { counts[g.subject_id] = (counts[g.subject_id] || 0) + 1; });
    return Object.entries(counts)
      .map(([subject_id, n]) => ({ subject_id: Number(subject_id), n }))
      .sort((a, b) => b.n - a.n);
  }, [subjectGaps]);

  if (loading) return <div><h1>Target Grade Coverage</h1><p>Loading...</p></div>;

  return (
    <div>
      <h1>Target Grade Coverage</h1>
      <p>
        Every student is issued a target grade for every subject the school targets, and the portals
        filter that set down to the subjects each student actually takes. A target for a subject a
        student does not study is therefore not a fault and is never removed.
      </p>
      <p>
        What this page lists is the opposite case: a subject a student <em>does</em> take where there is
        no target to show them — either because they hold none at all, or because that subject has no
        target of its own and no subject to read one from.
      </p>

      <h2>Students with no target grades at all ({noTargetsAtAll.length})</h2>
      {noTargetsAtAll.length === 0 ? <p>None.</p> : (
        <>
          <p>
            Nothing can be shown for any of their subjects. These are the students with no CAT4 result,
            so there was nothing to derive a target from — they need a CAT4 sitting, or targets set by
            hand on the student&apos;s own page.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Student</th><th>Year</th><th>UPN</th></tr></thead>
              <tbody>
                {noTargetsAtAll.map((s) => (
                  <tr key={s.student_id}>
                    <td>{s.first_name} {s.last_name}</td>
                    <td>{s.year_group}</td>
                    <td>{s.upn || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button className="secondary" onClick={() => downloadCsv(
              noTargetsAtAll.map((s) => ({
                upn: s.upn || '', student: `${s.first_name} ${s.last_name}`, year_group: s.year_group ?? '',
              })), 'students-with-no-target-grades')}>
              Export as CSV
            </button>
          </p>
        </>
      )}

      <h2>Subjects with no target available ({subjectGaps.length} across {bySubject.length} subjects)</h2>
      {bySubject.length === 0 ? <p>None — every subject taught has a target to show.</p> : (
        <>
          <p>
            These students hold targets, but take a subject that has none of its own and reads from
            nowhere. Each subject needs one decision, not a row-by-row fix: point it at the subject whose
            target should stand in for it on <code>/admin/subject-settings</code>, set targets for it by
            hand, or mark it as not carrying a target at all.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Students affected</th><th>Reads target from</th></tr></thead>
              <tbody>
                {bySubject.map(({ subject_id, n }) => (
                  <tr key={subject_id}>
                    <td>{subjectName(subject_id)}</td>
                    <td>{n}</td>
                    <td>{subjectsById[subject_id]?.target_fallback_subject_id
                      ? subjectName(subjectsById[subject_id].target_fallback_subject_id)
                      : <span style={{ color: '#a3232c' }}>nothing set</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button className="secondary" onClick={() => downloadCsv(
              subjectGaps.map((g) => ({
                upn: studentsById[g.student_id]?.upn || '',
                student: studentName(g.student_id),
                year_group: studentsById[g.student_id]?.year_group ?? '',
                subject: subjectName(g.subject_id),
              })), 'target-grades-no-source')}>
              Export these {subjectGaps.length} rows as CSV
            </button>
          </p>
        </>
      )}
    </div>
  );
}

export default function TargetGradeCoveragePage() {
  return <RequireAuth><RequireResource resourceKey="/target-grades/coverage"><CoverageInner /></RequireResource></RequireAuth>;
}
