'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

const EFFORT_GRADES = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement'];

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
  const [rows, setRows] = useState({}); // student_id -> { id, comment, effort_grade, status, checker_note }
  const [performance, setPerformance] = useState({}); // student_id -> { latestGrade, latestScorePct, targetGrade }
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
        .select('id, student_id, comment, effort_grade, status, checker_note')
        .eq('report_period_id', periodId)
        .eq('subject_id', selectedClass.subject_id)
        .in('student_id', ids);
      for (const r of existing || []) {
        nextRows[r.student_id] = { id: r.id, comment: r.comment || '', effort_grade: r.effort_grade || '', status: r.status, checker_note: r.checker_note || '' };
      }
    }
    for (const s of studentList) {
      if (!nextRows[s.student_id]) nextRows[s.student_id] = { id: null, comment: '', effort_grade: '', status: 'draft', checker_note: '' };
    }
    setRows(nextRows);

    // Latest result and target grade per student, to ground the AI draft in real data
    // rather than have it invent anything.
    const nextPerf = {};
    if (ids.length > 0) {
      const { data: targets } = await supabase
        .from('target_grades')
        .select('student_id, target_grade')
        .eq('subject_id', selectedClass.subject_id)
        .in('student_id', ids);
      for (const t of targets || []) {
        nextPerf[t.student_id] = { ...nextPerf[t.student_id], targetGrade: t.target_grade };
      }

      const { data: latestResults } = await supabase
        .from('results')
        .select('student_id, score, max_score, grade, week_start_date')
        .eq('subject_id', selectedClass.subject_id)
        .in('student_id', ids)
        .order('week_start_date', { ascending: false });
      for (const r of latestResults || []) {
        if (nextPerf[r.student_id]?.latestGrade) continue; // already have the most recent (results ordered desc)
        const pct = r.score != null && r.max_score ? Math.round((r.score / r.max_score) * 100) : null;
        nextPerf[r.student_id] = { ...nextPerf[r.student_id], latestGrade: r.grade, latestScorePct: pct };
      }
    }
    setPerformance(nextPerf);
    setLoadingRoster(false);
  }, [periodId, classId, selectedClass]);

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

  async function generateDraft(student) {
    const row = rows[student.student_id] || {};
    if (row.comment && row.comment.trim()) {
      if (!confirm(`Replace ${student.first_name}'s existing comment with an AI draft? This can't be undone.`)) return;
    }
    setGeneratingFor(student.student_id);
    setStatus(null);
    try {
      const perf = performance[student.student_id] || {};
      const res = await fetch('/api/generate-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'subject',
          studentFirstName: student.first_name,
          subjectName: selectedClass?.subjects?.subject_name,
          effortGrade: row.effort_grade,
          latestGrade: perf.latestGrade,
          latestScorePct: perf.latestScorePct,
          targetGrade: perf.targetGrade,
          priorComment: row.comment,
        }),
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
      <p>Pick a report period and one of your classes, then write a comment and set an effort grade for each student. Save as draft to keep editing, or submit when ready for checking.</p>

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

                  <label>
                    Effort grade
                    <select
                      value={row.effort_grade || ''}
                      onChange={(e) => updateField(s.student_id, 'effort_grade', e.target.value)}
                      disabled={locked}
                    >
                      <option value="">— Select —</option>
                      {EFFORT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>

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

export default function WriteSubjectCommentsPage() {
  return <RequireAuth><RequireResource resourceKey="/reports/write-subject-comments"><WriteSubjectCommentsInner /></RequireResource></RequireAuth>;
}
