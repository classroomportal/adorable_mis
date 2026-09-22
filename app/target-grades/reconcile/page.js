'use client';
import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';

// Supabase caps unpaginated selects at 1000 rows and the gap list is several
// thousand, so page through it rather than silently show a slice.
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

function ReconcileInner() {
  const [gaps, setGaps] = useState([]);
  const [studentsById, setStudentsById] = useState({});
  const [subjectsById, setSubjectsById] = useState({});
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [gapRows, students, subjects, runRows] = await Promise.all([
      fetchAll('target_grade_gaps', 'student_id, subject_id, gap, target_grade'),
      fetchAll('students', 'student_id, first_name, last_name, year_group, upn', (q) => q.eq('status', 'active')),
      fetchAll('subjects', 'subject_id, subject_name, display_name, carries_target_grade, target_fallback_subject_id'),
      supabase.from('target_grade_cleanup_runs').select('*').order('run_id', { ascending: false }).limit(10),
    ]);
    setGaps(gapRows);
    setStudentsById(Object.fromEntries(students.map((s) => [s.student_id, s])));
    setSubjectsById(Object.fromEntries(subjects.map((s) => [s.subject_id, s])));
    setRuns(runRows?.data || []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const subjectName = (id) => subjectsById[id]?.display_name || subjectsById[id]?.subject_name || `Subject ${id}`;
  const studentName = (id) => {
    const s = studentsById[id];
    return s ? `${s.first_name} ${s.last_name}` : `Student ${id}`;
  };

  const missing = useMemo(() => gaps.filter((g) => g.gap === 'missing'), [gaps]);
  const orphans = useMemo(() => gaps.filter((g) => g.gap === 'orphan'), [gaps]);

  // Per subject, so the shape of the problem is visible before anything is
  // removed: a subject with many missing and a near-twin with many orphans is
  // usually a mapping waiting to be set, not rows waiting to be deleted.
  function bySubject(rows) {
    const counts = {};
    rows.forEach((r) => { counts[r.subject_id] = (counts[r.subject_id] || 0) + 1; });
    return Object.entries(counts)
      .map(([subject_id, n]) => ({ subject_id: Number(subject_id), n }))
      .sort((a, b) => b.n - a.n);
  }

  const missingBySubject = useMemo(() => bySubject(missing), [missing, subjectsById]);
  const orphansBySubject = useMemo(() => bySubject(orphans), [orphans, subjectsById]);
  const studentsWithAnyGap = useMemo(() => new Set(gaps.map((g) => g.student_id)).size, [gaps]);

  function exportCsv(rows, filename) {
    const csv = Papa.unparse(rows.map((r) => ({
      upn: studentsById[r.student_id]?.upn || '',
      student: studentName(r.student_id),
      year_group: studentsById[r.student_id]?.year_group ?? '',
      subject: subjectName(r.subject_id),
      target_grade: r.target_grade || '',
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRemoveOrphans() {
    setBusy(true);
    setStatus('Removing...');
    const { data, error } = await supabase.rpc('apply_target_grade_cleanup', {
      p_note: `Removed ${orphans.length} targets for subjects not studied`,
    });
    if (error) { setStatus(`Error: ${error.message}`); setBusy(false); return; }
    setStatus(`Done — run #${data}. Every removed row is kept and can be undone below.`);
    setConfirming(false);
    setBusy(false);
    await loadAll();
  }

  async function handleUndo(runId) {
    setBusy(true);
    setStatus('Restoring...');
    const { data, error } = await supabase.rpc('undo_target_grade_cleanup', { p_run_id: runId });
    if (error) { setStatus(`Error: ${error.message}`); setBusy(false); return; }
    setStatus(`Restored ${data} target grade(s) from run #${runId}.`);
    setBusy(false);
    await loadAll();
  }

  if (loading) return <div><h1>Reconcile Target Grades</h1><p>Loading...</p></div>;

  return (
    <div>
      <h1>Reconcile Target Grades</h1>
      <p>
        A student should hold a target grade for every examined subject they are timetabled for, and for
        nothing else. This page shows both sides of that: subjects they study with no target, and targets
        for subjects they do not study.
      </p>
      <p>
        Before removing anything, check the two tables against each other. A subject with many missing
        targets sitting beside a subject with many spare ones is usually a mapping that has not been set —
        pointing one at the other on <code>/admin/subject-settings</code> fixes both sides at once and
        writes no rows. Removal is a last resort, and it is reversible.
      </p>

      <div className="card">
        <p>
          <strong>{studentsWithAnyGap}</strong> students have a gap of some kind —{' '}
          <strong>{missing.length}</strong> missing targets to create,{' '}
          <strong>{orphans.length}</strong> targets held for subjects not studied.
        </p>
        {status && <p>{status}</p>}
      </div>

      <h2>Targets for subjects the student does not study ({orphans.length})</h2>
      {orphansBySubject.length === 0 ? <p>None — every target belongs to a subject the student studies.</p> : (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Spare targets</th><th>Students studying it who have no target</th><th>Target read from</th></tr></thead>
              <tbody>
                {orphansBySubject.map(({ subject_id, n }) => (
                  <tr key={subject_id}>
                    <td>{subjectName(subject_id)}</td>
                    <td>{n}</td>
                    <td>{missingBySubject.find((m) => m.subject_id === subject_id)?.n || 0}</td>
                    <td>{subjectsById[subject_id]?.target_fallback_subject_id
                      ? subjectName(subjectsById[subject_id].target_fallback_subject_id) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button className="secondary" onClick={() => exportCsv(orphans, 'target-grades-not-studied')}>
              Export these {orphans.length} rows as CSV
            </button>{' '}
            {confirming ? (
              <>
                <button onClick={handleRemoveOrphans} disabled={busy}>
                  Yes — remove {orphans.length} target grades
                </button>{' '}
                <button className="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} disabled={busy || orphans.length === 0}>
                Remove all {orphans.length} targets for subjects not studied
              </button>
            )}
          </p>
          {confirming && (
            <p style={{ color: '#a3232c' }}>
              This removes {orphans.length} target grades across {new Set(orphans.map((o) => o.student_id)).size} students.
              Export the CSV first if you want a copy outside the system. The rows are kept either way and the run can be undone below.
            </p>
          )}
        </>
      )}

      <h2>Subjects studied with no target ({missing.length})</h2>
      {missingBySubject.length === 0 ? <p>None — every student holds a target for everything they study.</p> : (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Students with no target</th><th>Spare targets in this subject</th><th>Target read from</th></tr></thead>
              <tbody>
                {missingBySubject.map(({ subject_id, n }) => (
                  <tr key={subject_id}>
                    <td>{subjectName(subject_id)}</td>
                    <td>{n}</td>
                    <td>{orphansBySubject.find((o) => o.subject_id === subject_id)?.n || 0}</td>
                    <td>{subjectsById[subject_id]?.target_fallback_subject_id
                      ? subjectName(subjectsById[subject_id].target_fallback_subject_id) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '1rem' }}>
            <button className="secondary" onClick={() => exportCsv(missing, 'target-grades-missing')}>
              Export these {missing.length} rows as CSV
            </button>
          </p>
          <p style={{ color: '#666' }}>
            Missing targets are not filled in here — a target is a judgement, not a default. Fill them per
            student on the student&apos;s own page, or in bulk from <code>/target-grades/import</code>.
          </p>
        </>
      )}

      <h2>Cleanup history</h2>
      {runs.length === 0 ? <p>No cleanup has been run yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Run</th><th>When</th><th>Removed</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td>#{r.run_id}</td>
                  <td>{formatUKDate(r.created_at?.slice(0, 10))}</td>
                  <td>{r.removed_count}</td>
                  <td>{r.note || '—'}</td>
                  <td>
                    {r.undone_at
                      ? <span style={{ color: '#666' }}>Undone {formatUKDate(r.undone_at.slice(0, 10))}</span>
                      : <button className="secondary" onClick={() => handleUndo(r.run_id)} disabled={busy}>Undo</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReconcileTargetGradesPage() {
  return <RequireAuth><RequireResource resourceKey="/target-grades/reconcile"><ReconcileInner /></RequireResource></RequireAuth>;
}
