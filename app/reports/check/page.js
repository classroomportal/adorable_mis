'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

const TYPE_LABEL = { mentor: 'Mentor', houseparent: 'Houseparent', smt: 'SMT' };

function CheckReportsInner() {
  const { profile, staffRoles } = useAuth();
  const staffId = profile?.staff_id;
  const isAdmin = profile?.role === 'admin';
  const canSeeAllPeriods = isAdmin || (staffRoles || []).includes('smt');

  const [periods, setPeriods] = useState([]);
  const [allowedPeriodIds, setAllowedPeriodIds] = useState(null); // null = still loading; Set otherwise
  const [periodId, setPeriodId] = useState('');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pageStatus, setPageStatus] = useState(null);
  const [sendBackNotes, setSendBackNotes] = useState({}); // "kind-id" -> text

  useEffect(() => {
    supabase.from('report_periods').select('*').order('comments_due_date', { ascending: true })
      .then(({ data }) => setPeriods(data || []));
  }, []);

  useEffect(() => {
    if (!staffId) return;
    if (canSeeAllPeriods) { setAllowedPeriodIds('all'); return; }
    supabase.from('report_checkers').select('report_period_id').eq('staff_id', staffId)
      .then(({ data }) => setAllowedPeriodIds(new Set((data || []).map((r) => r.report_period_id))));
  }, [staffId, canSeeAllPeriods]);

  const checkablePeriods = allowedPeriodIds === 'all'
    ? periods
    : periods.filter((p) => allowedPeriodIds && allowedPeriodIds.has(p.report_period_id));

  const loadItems = useCallback(async () => {
    if (!periodId) { setItems([]); return; }
    setLoading(true);
    setPageStatus(null);

    const { data: subjectRows } = await supabase
      .from('report_subject_comments')
      .select('id, student_id, subject_id, comment, effort_grade, status, students(first_name, last_name), subjects(subject_name), staff(first_name, last_name)')
      .eq('report_period_id', periodId)
      .eq('status', 'submitted');

    const { data: pastoralRows } = await supabase
      .from('report_pastoral_comments')
      .select('id, student_id, comment_type, comment, status, students(first_name, last_name), staff(first_name, last_name)')
      .eq('report_period_id', periodId)
      .eq('status', 'submitted');

    const studentIds = Array.from(new Set((subjectRows || []).map((r) => r.student_id)));
    const perf = {}; // "studentId:subjectId" -> { latestGrade, latestScorePct }
    const targets = {}; // "studentId:subjectId" -> targetGrade
    if (studentIds.length > 0) {
      const { data: results } = await supabase
        .from('results')
        .select('student_id, subject_id, score, max_score, grade, week_start_date')
        .in('student_id', studentIds)
        .order('week_start_date', { ascending: false });
      for (const r of results || []) {
        const key = `${r.student_id}:${r.subject_id}`;
        if (perf[key]) continue; // already have the most recent
        const pct = r.score != null && r.max_score ? Math.round((r.score / r.max_score) * 100) : null;
        perf[key] = { latestGrade: r.grade, latestScorePct: pct };
      }
      const { data: tg } = await supabase
        .from('target_grades').select('student_id, subject_id, target_grade').in('student_id', studentIds);
      for (const t of tg || []) targets[`${t.student_id}:${t.subject_id}`] = t.target_grade;
    }

    const subjectItems = (subjectRows || []).map((r) => {
      const key = `${r.student_id}:${r.subject_id}`;
      return {
        id: r.id, kind: 'subject',
        studentFirstName: r.students?.first_name, studentLastName: r.students?.last_name,
        label: r.subjects?.subject_name,
        authorName: `${r.staff?.first_name || ''} ${r.staff?.last_name || ''}`.trim(),
        comment: r.comment || '', effortGrade: r.effort_grade,
        latestGrade: perf[key]?.latestGrade, latestScorePct: perf[key]?.latestScorePct, targetGrade: targets[key],
        ai: null,
      };
    });
    const pastoralItems = (pastoralRows || []).map((r) => ({
      id: r.id, kind: 'pastoral',
      studentFirstName: r.students?.first_name, studentLastName: r.students?.last_name,
      label: TYPE_LABEL[r.comment_type] || r.comment_type,
      authorName: `${r.staff?.first_name || ''} ${r.staff?.last_name || ''}`.trim(),
      comment: r.comment || '', effortGrade: null,
      latestGrade: null, latestScorePct: null, targetGrade: null,
      ai: null,
    }));

    setItems([...subjectItems, ...pastoralItems]);
    setLoading(false);
  }, [periodId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  function itemKey(it) { return `${it.kind}-${it.id}`; }

  function updateComment(it, value) {
    setItems((prev) => prev.map((x) => (itemKey(x) === itemKey(it) ? { ...x, comment: value } : x)));
  }

  async function runCheck() {
    if (items.length === 0) return;
    setChecking(true);
    setPageStatus(null);
    try {
      const res = await fetch('/api/check-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({
            id: itemKey(it), studentFirstName: it.studentFirstName, comment: it.comment,
            effortGrade: it.effortGrade, latestGrade: it.latestGrade, latestScorePct: it.latestScorePct, targetGrade: it.targetGrade,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPageStatus(`AI check failed: ${data.error || 'unknown error'}`); return; }
      const byKey = {};
      for (const r of data.results || []) byKey[r.id] = r;
      setItems((prev) => [...prev]
        .map((it) => ({ ...it, ai: byKey[itemKey(it)] || { hasIssues: false, issues: [], suggestion: null } }))
        .sort((a, b) => (b.ai?.hasIssues ? 1 : 0) - (a.ai?.hasIssues ? 1 : 0)));
      setPageStatus(`Checked ${items.length} comment(s) — ${(data.results || []).filter((r) => r.hasIssues).length} flagged.`);
    } catch (err) {
      setPageStatus(`AI check failed: ${err.message}`);
    } finally {
      setChecking(false);
    }
  }

  async function approve(it) {
    const table = it.kind === 'subject' ? 'report_subject_comments' : 'report_pastoral_comments';
    const { error } = await supabase.from(table)
      .update({ comment: it.comment, status: 'checked', checked_by: staffId, checked_at: new Date().toISOString() })
      .eq('id', it.id);
    if (error) { setPageStatus(`Error: ${error.message}`); return; }
    setItems((prev) => prev.filter((x) => itemKey(x) !== itemKey(it)));
  }

  async function sendBack(it) {
    const note = (sendBackNotes[itemKey(it)] || '').trim();
    if (!note) { setPageStatus('Add a note explaining what needs fixing before sending back.'); return; }
    const table = it.kind === 'subject' ? 'report_subject_comments' : 'report_pastoral_comments';
    const { error } = await supabase.from(table)
      .update({ status: 'draft', checker_note: note }).eq('id', it.id);
    if (error) { setPageStatus(`Error: ${error.message}`); return; }
    setItems((prev) => prev.filter((x) => itemKey(x) !== itemKey(it)));
  }

  return (
    <div>
      <h1>Check Reports</h1>
      <p>Pick a report period to see comments submitted for checking. Run the AI check to flag likely issues before you read — clean comments can be approved straight away.</p>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Report Period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} disabled={allowedPeriodIds === null}>
            <option value="">Select a report period...</option>
            {checkablePeriods.map((p) => (
              <option key={p.report_period_id} value={p.report_period_id}>
                {p.name}{p.check_due_date ? ` — check by ${formatUKDate(p.check_due_date)}` : ''}
              </option>
            ))}
          </select>
        </label>
      </form>

      {allowedPeriodIds !== null && allowedPeriodIds !== 'all' && allowedPeriodIds.size === 0 && (
        <p style={{ color: '#666' }}>You aren't assigned to check any report period yet — ask an admin to add you under Manage Report Periods.</p>
      )}

      {loading && <p>Loading submitted comments...</p>}

      {!loading && periodId && items.length === 0 && (
        <p style={{ color: '#666' }}>Nothing submitted for checking in this period yet.</p>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="card" style={{ alignItems: 'center' }}>
            <strong>{items.length} comment{items.length === 1 ? '' : 's'} awaiting check</strong>
            <button type="button" onClick={runCheck} disabled={checking}>
              {checking ? 'Checking...' : '✨ Run AI check'}
            </button>
          </div>
          {pageStatus && <p>{pageStatus}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
            {items.map((it) => {
              const flagged = it.ai?.hasIssues;
              return (
                <div
                  key={itemKey(it)}
                  className="card"
                  style={{ marginBottom: 0, borderLeft: flagged ? '4px solid #c0272d' : it.ai ? '4px solid #1a7a3d' : undefined }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <strong>{it.studentFirstName} {it.studentLastName}</strong>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>
                      {it.label} — written by {it.authorName || 'unknown'}
                      {it.effortGrade ? ` — effort: ${it.effortGrade}` : ''}
                      {it.targetGrade ? ` — target: ${it.targetGrade}` : ''}
                      {it.latestGrade ? ` — latest: ${it.latestGrade}` : ''}
                    </span>
                  </div>

                  {it.ai && flagged && (
                    <div style={{ background: '#fdecea', border: '1px solid #f0b8b4', borderRadius: 6, padding: '0.5rem', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                      <strong>AI flagged:</strong>
                      <ul style={{ margin: '0.25rem 0 0.25rem 1.1rem' }}>
                        {(it.ai.issues || []).map((issue, i) => <li key={i}>{issue}</li>)}
                      </ul>
                      {it.ai.suggestion && (
                        <button type="button" className="secondary" style={{ marginTop: '0.4rem' }}
                          onClick={() => updateComment(it, it.ai.suggestion)}>
                          Use suggested fix
                        </button>
                      )}
                    </div>
                  )}
                  {it.ai && !flagged && (
                    <p style={{ color: '#1a7a3d', fontSize: '0.85rem', margin: '0.5rem 0' }}>No issues found by AI check.</p>
                  )}

                  <textarea
                    value={it.comment}
                    onChange={(e) => updateComment(it, e.target.value)}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                  />

                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" onClick={() => approve(it)}>Approve</button>
                    <input
                      placeholder="Note for the teacher (required to send back)"
                      value={sendBackNotes[itemKey(it)] || ''}
                      onChange={(e) => setSendBackNotes((prev) => ({ ...prev, [itemKey(it)]: e.target.value }))}
                      style={{ flex: '1 1 220px' }}
                    />
                    <button type="button" className="secondary" onClick={() => sendBack(it)}>Send back</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function CheckReportsPage() {
  return <RequireAuth><CheckReportsInner /></RequireAuth>;
}
