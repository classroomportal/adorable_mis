'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import {
  JUDGEMENTS, JUDGEMENT_GRADES, SHOWN_WEEKS, isExamResult, loadAcademicYear, weekLabel,
  loadGradePoints, loadYearResults, loadTargets, summariseGrades, describeVsTarget,
} from '../../../lib/reportWriting';
import { subjectFacts } from '../../../lib/reportFacts';
import GradeChip from '../../components/GradeChip';
import GradeSparkline from '../../components/GradeSparkline';

const EMPTY_ROW = { id: null, comment: '', effort_grade: '', presentation_grade: '', homework_grade: '', status: 'draft', checker_note: '' };

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted — awaiting check',
  checked: 'Checked',
};

function WriteSubjectCommentsInner() {
  const { profile } = useAuth();
  const staffId = profile?.staff_id;

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');

  const [roster, setRoster] = useState([]);
  const [rows, setRows] = useState({}); // student_id -> { id, comment, effort_grade, presentation_grade, homework_grade, status, checker_note }
  // Grades this year in this subject: { points, weeks: [{ label, date }] (the last few, shown as columns),
  // byStudent: student_id -> { results: [{ ...result, label }], target } }
  const [grades, setGrades] = useState(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [generatingFor, setGeneratingFor] = useState(null); // student_id currently generating, or null
  const [status, setStatus] = useState(null);

  const selectedPeriod = periods.find((p) => String(p.report_period_id) === String(periodId));
  const selectedClass = classes.find((c) => String(c.class_id) === String(classId));

  useEffect(() => {
    if (!staffId) return;
    supabase
      .from('report_periods')
      .select('*')
      .order('comments_due_date', { ascending: true })
      .then(({ data }) => setPeriods(data || []));

    supabase
      .from('classes')
      .select('class_id, class_code, subject_id, year_group, subjects(subject_name)')
      .eq('staff_id', staffId)
      .order('class_code')
      .then(({ data }) => setClasses(data || []));
  }, [staffId]);

  // Classes relevant to the selected period's year groups only
  const classesForPeriod = selectedPeriod
    ? classes.filter((c) => (selectedPeriod.year_groups || []).includes(c.year_group))
    : [];

  const loadRosterAndExisting = useCallback(async () => {
    if (!periodId || !classId || !selectedClass) {
      setRoster([]);
      setRows({});
      return;
    }
    setLoadingRoster(true);
    setStatus(null);

    const { data: sc } = await supabase
      .from('student_class')
      .select('students(student_id, first_name, last_name, year_group, status)')
      .eq('class_id', classId);
    const studentList = (sc || [])
      .map((r) => r.students)
      .filter((s) => s && s.status === 'active')
      .sort((a, b) => a.last_name.localeCompare(b.last_name));
    setRoster(studentList);

    const ids = studentList.map((s) => s.student_id);
    const nextRows = {};
    if (ids.length > 0) {
      const { data: existing } = await supabase
        .from('report_subject_comments')
        .select('id, student_id, comment, effort_grade, presentation_grade, homework_grade, status, checker_note')
        .eq('report_period_id', periodId)
        .eq('subject_id', selectedClass.subject_id)
        .in('student_id', ids);
      for (const r of existing || []) {
        nextRows[r.student_id] = {
          id: r.id, comment: r.comment || '', status: r.status, checker_note: r.checker_note || '',
          effort_grade: r.effort_grade || '', presentation_grade: r.presentation_grade || '', homework_grade: r.homework_grade || '',
        };
      }
    }
    for (const s of studentList) {
      if (!nextRows[s.student_id]) nextRows[s.student_id] = { ...EMPTY_ROW };
    }
    setRows(nextRows);

    // Every grade this year in this subject, and the target, so the teacher
    // can see how the student has done while writing — and so the AI draft
    // is grounded in the same grades rather than the latest one alone.
    const [year, points] = await Promise.all([loadAcademicYear(selectedPeriod?.term_id), loadGradePoints()]);
    const [results, targets] = await Promise.all([
      loadYearResults({ studentIds: ids, subjectId: selectedClass.subject_id, year }),
      loadTargets({ studentIds: ids, subjectId: selectedClass.subject_id }),
    ]);
    const byStudent = {};
    for (const s of studentList) byStudent[s.student_id] = { results: [], target: targets[`${s.student_id}:${selectedClass.subject_id}`] || null };
    const weekDates = {};
    for (const r of results) {
      const label = weekLabel(r.week_start_date, year);
      byStudent[r.student_id]?.results.push({ ...r, label });
      if (!weekDates[label] || r.week_start_date > weekDates[label]) weekDates[label] = r.week_start_date;
    }
    // The class's most recent weeks with any result become the columns, so
    // every student's row lines up under the same headings.
    const weeks = Object.entries(weekDates)
      .sort((x, y) => x[1].localeCompare(y[1]))
      .slice(-SHOWN_WEEKS)
      .map(([label, date]) => ({ label, date }));
    setGrades({ points, weeks, byStudent });
    setLoadingRoster(false);
  }, [periodId, classId, selectedClass, selectedPeriod]);

  useEffect(() => {
    loadRosterAndExisting();
  }, [loadRosterAndExisting]);

  function isLocked(row) {
    return row.status !== 'draft';
  }

  function updateField(studentId, field, value) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [field]: value } }));
  }

  async function saveRow(studentId, newStatus) {
    const row = rows[studentId];
    if (!row) return;
    const payload = {
      report_period_id: Number(periodId),
      student_id: studentId,
      subject_id: selectedClass.subject_id,
      staff_id: staffId,
      comment: row.comment || null,
      effort_grade: row.effort_grade || null,
      presentation_grade: row.presentation_grade || null,
      homework_grade: row.homework_grade || null,
      status: newStatus,
    };
    const { data, error } = await supabase
      .from('report_subject_comments')
      .upsert([payload], { onConflict: 'report_period_id,student_id,subject_id' })
      .select()
      .single();

    if (error) {
      setStatus(`Error saving: ${error.message}`);
      return;
    }
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], id: data.id, status: data.status } }));
  }

  // Everything the AI draft is given for one student. Also listed on screen
  // under "What the AI draft is based on", via the same subjectFacts().
  function draftPayload(student, row) {
    const g = grades?.byStudent[student.student_id] || { results: [], target: null };
    const summary = grades ? summariseGrades(g.results, grades.points) : null;
    return {
      kind: 'subject',
      studentFirstName: student.first_name,
      subjectName: selectedClass?.subjects?.subject_name,
      effortGrade: row.effort_grade,
      presentationGrade: row.presentation_grade,
      homeworkGrade: row.homework_grade,
      targetGrade: g.target,
      gradeHistory: g.results.map((r) => ({ label: r.label, grade: r.grade, isExam: isExamResult(r) })),
      bestGrade: summary && `${summary.best.grade} (${summary.best.label})`,
      lowestGrade: summary && `${summary.lowest.grade} (${summary.lowest.label})`,
      latestGrade: summary && `${summary.latest.grade} (${summary.latest.label})`,
      priorComment: row.comment,
    };
  }

  async function generateDraft(student) {
    const row = rows[student.student_id] || {};
    if (row.comment && row.comment.trim()) {
      if (!confirm(`Replace ${student.first_name}'s existing comment with an AI draft? This can't be undone.`)) return;
    }
    setGeneratingFor(student.student_id);
    setStatus(null);
    try {
      const res = await fetch('/api/generate-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPayload(student, row)),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Couldn't generate a draft: ${data.error || 'unknown error'}`);
        return;
      }
      updateField(student.student_id, 'comment', data.draft || '');
    } catch (err) {
      setStatus(`Couldn't generate a draft: ${err.message}`);
    } finally {
      setGeneratingFor(null);
    }
  }

  async function submitAllDrafts() {
    const toSubmit = roster.filter((s) => {
      const r = rows[s.student_id];
      return r && r.status === 'draft' && r.comment && r.comment.trim();
    });
    if (toSubmit.length === 0) {
      setStatus('Nothing to submit — write a comment for at least one student first.');
      return;
    }
    setStatus('Submitting...');
    for (const s of toSubmit) {
      await saveRow(s.student_id, 'submitted');
    }
    setStatus(`Submitted ${toSubmit.length} comment(s) for checking.`);
  }

  return (
    <div>
      <h1>Write Subject Comments</h1>
      <p>Pick a report period and one of your classes. For each student you&apos;ll see their last {SHOWN_WEEKS} weeks of grades in your subject, coloured against their target; grade their effort, presentation of work and homework, then write a comment. Save as draft to keep editing, or submit when ready for checking.</p>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Report Period
          <select value={periodId} onChange={(e) => { setPeriodId(e.target.value); setClassId(''); }}>
            <option value="">Select a report period...</option>
            {periods.map((p) => (
              <option key={p.report_period_id} value={p.report_period_id}>
                {p.name}{p.comments_due_date ? ` — due ${formatUKDate(p.comments_due_date)}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!periodId}>
            <option value="">Select a class...</option>
            {classesForPeriod.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.class_code} — {c.subjects?.subject_name}
              </option>
            ))}
          </select>
        </label>
      </form>

      {periodId && classesForPeriod.length === 0 && (
        <p style={{ color: '#666' }}>None of your classes fall in this report period's year groups.</p>
      )}

      {loadingRoster && <p>Loading class list...</p>}

      {!loadingRoster && selectedClass && roster.length > 0 && (
        <>
          <GradeLegend />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {roster.map((s) => {
              const row = rows[s.student_id] || {};
              const locked = isLocked(row);
              return (
                <div key={s.student_id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <strong>{s.first_name} {s.last_name}</strong>
                    <span style={{ fontSize: '0.8rem', color: locked ? '#1a7a3d' : '#666' }}>
                      {STATUS_LABEL[row.status] || 'Draft'}
                    </span>
                  </div>

                  {row.checker_note && (
                    <p style={{ background: '#fff7e0', border: '1px solid #eecb7a', borderRadius: 6, padding: '0.5rem', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                      <strong>Checker note:</strong> {row.checker_note}
                    </p>
                  )}

                  <GradesThisYear grades={grades} studentId={s.student_id} />

                  <div className="report-judgements">
                    {JUDGEMENTS.map((j) => (
                      <label key={j.key}>
                        {j.label}
                        <select
                          value={row[j.column] || ''}
                          onChange={(e) => updateField(s.student_id, j.column, e.target.value)}
                          disabled={locked}
                        >
                          <option value="">— Select —</option>
                          {JUDGEMENT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>

                  <label style={{ display: 'block', marginTop: '0.5rem' }}>
                    Comment
                    <textarea
                      value={row.comment || ''}
                      onChange={(e) => updateField(s.student_id, 'comment', e.target.value)}
                      disabled={locked}
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </label>

                  <details className="report-ai-facts">
                    <summary>What the AI draft is based on</summary>
                    <ul>
                      {subjectFacts(draftPayload(s, row)).map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </details>

                  {!locked && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => generateDraft(s)}
                        disabled={generatingFor === s.student_id}
                      >
                        {generatingFor === s.student_id ? 'Generating...' : '✨ Generate draft'}
                      </button>
                      <button type="button" className="secondary" onClick={() => saveRow(s.student_id, 'draft')}>Save Draft</button>
                      <button type="button" onClick={() => saveRow(s.student_id, 'submitted')}>Submit</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" onClick={submitAllDrafts} style={{ marginTop: '1rem' }}>
            Submit All Drafts
          </button>
          {status && <p>{status}</p>}
        </>
      )}

      {!loadingRoster && selectedClass && roster.length === 0 && (
        <p style={{ color: '#666' }}>No students are linked to this class yet.</p>
      )}
    </div>
  );
}

function GradeLegend() {
  return (
    <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', alignItems: 'center', fontSize: '0.8rem', color: '#5b6472' }}>
      <span><GradeChip grade="A" target="B" points={{ A: 7, B: 6 }} /> above target</span>
      <span><GradeChip grade="B" target="B" points={{ B: 6 }} /> on target</span>
      <span><GradeChip grade="C" target="B" points={{ C: 5, B: 6 }} /> below target</span>
      <span><GradeChip grade="B" isTarget /> target</span>
      <span><GradeChip grade="B" exam /> exam</span>
    </p>
  );
}

// The student's grades in this subject this year: the last few weeks as
// columns, then best / lowest / average / latest and the trend worked out
// over the whole year.
function GradesThisYear({ grades, studentId }) {
  if (!grades) return null;
  const g = grades.byStudent[studentId];
  if (!g || g.results.length === 0) {
    return <p style={{ color: '#666', fontSize: '0.85rem' }}>No grades recorded in this subject yet this year.{g?.target ? ` Target ${g.target}.` : ''}</p>;
  }
  const { points, weeks } = grades;
  const summary = summariseGrades(g.results, points);
  const hidden = new Set(g.results.map((r) => r.label));
  weeks.forEach((w) => hidden.delete(w.label));
  const trend = summary && (summary.change > 0 ? `up ${summary.change} since ${summary.first.label}`
    : summary.change < 0 ? `down ${-summary.change} since ${summary.first.label}` : `level since ${summary.first.label}`);
  const vsTarget = summary && g.target && describeVsTarget(summary.latest.grade, g.target, points);
  return (
    <div style={{ margin: '0.5rem 0' }}>
      <div className="table-scroll" style={{ marginTop: 0, boxShadow: 'none' }}>
        <table className="report-grades">
          <thead>
            <tr>
              <th>Last {weeks.length} week{weeks.length === 1 ? '' : 's'}</th>
              {weeks.map((w) => <th key={w.label}>{w.label}<span>{formatUKDate(w.date)}</span></th>)}
              <th>Target</th>
              <th>Trend, all year</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontSize: '0.8rem', color: '#5b6472' }}>{hidden.size > 0 ? `${hidden.size} earlier week${hidden.size === 1 ? '' : 's'} hidden` : ''}</td>
              {weeks.map((w) => {
                const inWeek = g.results.filter((r) => r.label === w.label);
                return (
                  <td key={w.label}>
                    {inWeek.length === 0 ? <span style={{ color: '#aaa' }}>—</span> : inWeek.map((r) => (
                      <GradeChip key={r.result_id} grade={r.grade} target={g.target} points={points} exam={isExamResult(r)} />
                    ))}
                  </td>
                );
              })}
              <td>{g.target ? <GradeChip grade={g.target} isTarget /> : <span style={{ color: '#aaa' }}>—</span>}</td>
              <td><GradeSparkline grades={g.results.map((r) => r.grade)} target={g.target} points={points} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      {summary && (
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
          <span style={{ color: '#5b6472' }}>This year:</span>
          <span>Best <strong>{summary.best.grade}</strong> <span style={{ color: '#5b6472' }}>({summary.best.label})</span></span>
          <span>Lowest <strong>{summary.lowest.grade}</strong> <span style={{ color: '#5b6472' }}>({summary.lowest.label})</span></span>
          {summary.average && <span>Average <strong>{summary.average}</strong></span>}
          <span>Latest <strong>{summary.latest.grade}</strong>{vsTarget ? <span style={{ color: '#5b6472' }}> — {vsTarget}</span> : null}</span>
          <span style={{ color: '#5b6472' }}>{trend}</span>
        </p>
      )}
    </div>
  );
}

export default function WriteSubjectCommentsPage() {
  return <RequireAuth><RequireResource resourceKey="/reports/write-subject-comments"><WriteSubjectCommentsInner /></RequireResource></RequireAuth>;
}
