'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import {
  JUDGEMENTS, JUDGEMENT_GRADES, loadAcademicYear, loadGradePoints, loadYearResults, loadTargets,
  loadBehaviourTotals, rankSubjects,
} from '../../../lib/reportWriting';
import { pastoralFacts } from '../../../lib/reportFacts';
import GradeChip from '../../components/GradeChip';

// How many subjects to show as "best" and as "weakest".
const RANKED_SUBJECTS = 3;
// The weakest subjects, weakest first, never repeating one already shown
// as a best subject (a student with four subjects gets 3 best, 1 weakest).
const weakestOf = (ranked) => ranked.slice(Math.max(RANKED_SUBJECTS, ranked.length - RANKED_SUBJECTS)).reverse();

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted — awaiting check',
  checked: 'Checked',
};

const TYPE_LABEL = {
  mentor: 'Mentor',
  houseparent: 'Houseparent',
  smt: 'SMT',
};

function WritePastoralCommentsInner() {
  const { profile, staffRoles } = useAuth();
  const staffId = profile?.staff_id;
  const isAdmin = profile?.role === 'admin';

  const [availableTypes, setAvailableTypes] = useState([]); // ['mentor','houseparent','smt']
  const [houseScope, setHouseScope] = useState(null);
  const [menteeIds, setMenteeIds] = useState([]);
  const [commentType, setCommentType] = useState('');

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');

  const [roster, setRoster] = useState([]);
  const [rows, setRows] = useState({});
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [status, setStatus] = useState(null);
  const [generatingFor, setGeneratingFor] = useState(null); // student_id currently generating, or null
  // student_id -> { behaviour, ranked: [...subjects best first], judgements: { effort: { Excellent: n, ... }, ... }, subjectCount }
  const [overview, setOverview] = useState({});

  const [yearFilter, setYearFilter] = useState(''); // SMT only — narrows a potentially large roster
  const [search, setSearch] = useState('');

  const selectedPeriod = periods.find((p) => String(p.report_period_id) === String(periodId));

  useEffect(() => {
    if (!staffId) return;
    supabase.from('report_periods').select('*').order('comments_due_date', { ascending: true })
      .then(({ data }) => setPeriods(data || []));

    async function resolveScopes() {
      const types = [];
      // Mentees come from the Mentor-block classes this person teaches, not
      // from students.mentor_staff_id — that column has never been populated,
      // so counting it meant the Mentor option never appeared (migration 127).
      const { data: mentees } = await supabase.rpc('my_mentee_ids');
      const menteeList = (mentees || []).map((m) => (typeof m === 'object' ? m.my_mentee_ids : m));
      if (menteeList.length > 0) { types.push('mentor'); setMenteeIds(menteeList); }

      const { data: scope } = await supabase.rpc('my_house_scope');
      if (scope) { types.push('houseparent'); setHouseScope(scope); }

      if (isAdmin || (staffRoles || []).includes('smt')) types.push('smt');

      setAvailableTypes(types);
      if (types.length === 1) setCommentType(types[0]);
    }
    resolveScopes();
  }, [staffId, isAdmin, staffRoles]);

  const loadRosterAndExisting = useCallback(async () => {
    if (!periodId || !commentType || !selectedPeriod) {
      setRoster([]);
      setRows({});
      return;
    }
    setLoadingRoster(true);
    setStatus(null);

    const yearGroups = selectedPeriod.year_groups || [];
    let query = supabase
      .from('students')
      .select('student_id, first_name, last_name, year_group, form_class, boarding_house')
      .in('year_group', yearGroups.length ? yearGroups : [-1])
      .eq('status', 'active')
      .order('last_name');

    if (commentType === 'mentor') query = query.in('student_id', menteeIds.length ? menteeIds : [-1]);
    if (commentType === 'houseparent') query = query.eq('boarding_house', houseScope);
    if (commentType === 'smt') {
      if (yearFilter) query = query.eq('year_group', Number(yearFilter));
      if (search.trim()) query = query.or(`first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%`);
    }

    const { data: studentList } = await query;
    setRoster(studentList || []);

    const ids = (studentList || []).map((s) => s.student_id);
    const nextRows = {};
    if (ids.length > 0) {
      const { data: existing } = await supabase
        .from('report_pastoral_comments')
        .select('id, student_id, comment, status, checker_note')
        .eq('report_period_id', periodId)
        .eq('comment_type', commentType)
        .in('student_id', ids);
      for (const r of existing || []) {
        nextRows[r.student_id] = { id: r.id, comment: r.comment || '', status: r.status, checker_note: r.checker_note || '' };
      }
    }
    for (const s of studentList || []) {
      if (!nextRows[s.student_id]) nextRows[s.student_id] = { id: null, comment: '', status: 'draft', checker_note: '' };
    }
    setRows(nextRows);

    // What the writer needs to see about each student: behaviour this year,
    // their strongest and weakest subjects, and the effort / presentation /
    // homework grades subject teachers have given this period. Attendance
    // is deliberately left out — as a boarding school it isn't reported on.
    const nextOverview = {};
    if (ids.length > 0) {
      const [year, points] = await Promise.all([loadAcademicYear(selectedPeriod.term_id), loadGradePoints()]);
      const [results, targets, behaviour, judgementRes] = await Promise.all([
        loadYearResults({ studentIds: ids, year }),
        loadTargets({ studentIds: ids }),
        loadBehaviourTotals({ studentIds: ids, year }),
        supabase.rpc('report_pastoral_grades', { p_report_period_id: Number(periodId), p_student_ids: ids }),
      ]);
      const resultsByStudent = {};
      for (const r of results) (resultsByStudent[r.student_id] ||= []).push(r);
      for (const id of ids) {
        nextOverview[id] = {
          behaviour: behaviour[id] || { plus: 0, plusEvents: 0, minus: 0, minusEvents: 0, positives: [], negatives: [] },
          ranked: rankSubjects(resultsByStudent[id] || [], targets, id, points),
          judgements: Object.fromEntries(JUDGEMENTS.map((j) => [j.key, {}])),
          subjectCount: 0,
          points,
        };
      }
      for (const g of judgementRes.data || []) {
        const o = nextOverview[g.student_id];
        if (!o) continue;
        o.subjectCount += 1;
        for (const j of JUDGEMENTS) {
          const v = g[j.column];
          if (v) o.judgements[j.key][v] = (o.judgements[j.key][v] || 0) + 1;
        }
      }
    }
    setOverview(nextOverview);
    setLoadingRoster(false);
  }, [periodId, commentType, selectedPeriod, menteeIds, houseScope, yearFilter, search]);

  useEffect(() => { loadRosterAndExisting(); }, [loadRosterAndExisting]);

  function isLocked(row) { return row.status !== 'draft'; }

  function updateComment(studentId, value) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], comment: value } }));
  }

  async function saveRow(studentId, newStatus) {
    const row = rows[studentId];
    if (!row) return;
    const payload = {
      report_period_id: Number(periodId),
      student_id: studentId,
      staff_id: staffId,
      comment_type: commentType,
      comment: row.comment || null,
      status: newStatus,
    };
    const { data, error } = await supabase
      .from('report_pastoral_comments')
      .upsert([payload], { onConflict: 'report_period_id,student_id,comment_type' })
      .select()
      .single();

    if (error) { setStatus(`Error saving: ${error.message}`); return; }
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], id: data.id, status: data.status } }));
  }

  // Everything the AI draft is given for one student. Also listed on screen
  // under "What the AI draft is based on", via the same pastoralFacts().
  function draftPayload(student, row) {
    const o = overview[student.student_id];
    const fmt = (x) => `${x.subject} ${x.grade}${x.target ? ` (target ${x.target})` : ''}`;
    const ranked = o?.ranked || [];
    return {
      kind: 'pastoral',
      commentType,
      studentFirstName: student.first_name,
      behaviour: o && {
        plus: o.behaviour.plus,
        plusEvents: o.behaviour.plusEvents,
        minus: o.behaviour.minus,
        minusEvents: o.behaviour.minusEvents,
        topPositive: o.behaviour.positives.slice(0, 3).map((c) => `${c.name} (${c.count})`),
        topNegative: o.behaviour.negatives.slice(0, 3).map((c) => `${c.name} (${c.count})`),
      },
      bestGrades: ranked.slice(0, RANKED_SUBJECTS).map(fmt),
      weakestGrades: weakestOf(ranked).map(fmt),
      teacherJudgements: o ? JUDGEMENTS.map((j) => {
        const counts = JUDGEMENT_GRADES.filter((g) => o.judgements[j.key][g]).map((g) => `${o.judgements[j.key][g]} × ${g}`);
        return counts.length ? `${j.label} grades from subject teachers: ${counts.join(', ')}` : null;
      }) : [],
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
      if (!res.ok) { setStatus(`Couldn't generate a draft: ${data.error || 'unknown error'}`); return; }
      updateComment(student.student_id, data.draft || '');
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
    if (toSubmit.length === 0) { setStatus('Nothing to submit — write a comment for at least one student first.'); return; }
    setStatus('Submitting...');
    for (const s of toSubmit) await saveRow(s.student_id, 'submitted');
    setStatus(`Submitted ${toSubmit.length} comment(s) for checking.`);
  }

  if (availableTypes.length === 0) {
    return (
      <div>
        <h1>Write Pastoral Comments</h1>
        <p style={{ color: '#666' }}>You aren't currently scoped as a Mentor, Houseparent, or SMT — there's nothing to write here.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Write Pastoral Comments</h1>
      <p>Pick a report period and, if you hold more than one pastoral role, which comment you&apos;re writing. For each student you&apos;ll see their behaviour points this year, their best and weakest grades, and the effort, presentation and homework grades subject teachers have given.</p>

      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Report Period
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">Select a report period...</option>
            {periods.map((p) => (
              <option key={p.report_period_id} value={p.report_period_id}>
                {p.name}{p.comments_due_date ? ` — due ${formatUKDate(p.comments_due_date)}` : ''}
              </option>
            ))}
          </select>
        </label>

        {availableTypes.length > 0 && (
          <label>
            Writing as
            <select value={commentType} onChange={(e) => setCommentType(e.target.value)}>
              <option value="">Select...</option>
              {availableTypes.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
        )}

        {commentType === 'smt' && (
          <>
            <label>
              Year group
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">All</option>
                {(selectedPeriod?.year_groups || []).map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </label>
            <label>
              Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student name..." />
            </label>
          </>
        )}
      </form>

      {loadingRoster && <p>Loading roster...</p>}

      {!loadingRoster && commentType && roster.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {roster.map((s) => {
              const row = rows[s.student_id] || {};
              const locked = isLocked(row);
              return (
                <div key={s.student_id} className="card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <strong>{s.first_name} {s.last_name}</strong>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>Year {s.year_group}{s.form_class ? ` / ${s.form_class}` : ''}</span>
                    <span style={{ fontSize: '0.8rem', color: locked ? '#1a7a3d' : '#666' }}>
                      {STATUS_LABEL[row.status] || 'Draft'}
                    </span>
                  </div>

                  {row.checker_note && (
                    <p style={{ background: '#fff7e0', border: '1px solid #eecb7a', borderRadius: 6, padding: '0.5rem', fontSize: '0.85rem', margin: '0.5rem 0' }}>
                      <strong>Checker note:</strong> {row.checker_note}
                    </p>
                  )}

                  <StudentOverview overview={overview[s.student_id]} />

                  <label style={{ display: 'block', marginTop: '0.5rem' }}>
                    Comment
                    <textarea
                      value={row.comment || ''}
                      onChange={(e) => updateComment(s.student_id, e.target.value)}
                      disabled={locked}
                      rows={3}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </label>

                  <details className="report-ai-facts">
                    <summary>What the AI draft is based on</summary>
                    <ul>
                      {pastoralFacts(draftPayload(s, row)).map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </details>

                  {!locked && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => generateDraft(s)}
                        disabled={generatingFor === s.student_id || !overview[s.student_id]}
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

      {!loadingRoster && commentType && periodId && roster.length === 0 && (
        <p style={{ color: '#666' }}>No students in your scope for this report period.</p>
      )}
    </div>
  );
}

const muted = { color: '#5b6472' };

// Behaviour this year, best and weakest subjects, and the grades subject
// teachers have given — what the writer and the AI draft both work from.
function StudentOverview({ overview }) {
  if (!overview) return null;
  const { behaviour: b, ranked, judgements, subjectCount, points } = overview;
  const best = ranked.slice(0, RANKED_SUBJECTS);
  const weakest = weakestOf(ranked);
  const net = b.plus + b.minus;
  const gradeRow = (x) => (
    <li key={x.subjectId}>
      <span>{x.subject}</span>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <GradeChip grade={x.grade} target={x.target} points={points} />
        <span style={{ ...muted, fontSize: '0.8rem' }}>{x.target ? `target ${x.target}` : 'no target'}</span>
      </span>
    </li>
  );
  return (
    <div className="report-overview">
      <div className="report-tiles">
        <div><span>Plus points</span><strong style={{ color: '#1a7a3d' }}>+{b.plus}</strong><small>{b.plusEvents} award{b.plusEvents === 1 ? '' : 's'}</small></div>
        <div><span>Minus points</span><strong style={{ color: b.minus ? '#b3282d' : undefined }}>{b.minus}</strong><small>{b.minusEvents} incident{b.minusEvents === 1 ? '' : 's'}</small></div>
        <div><span>Net</span><strong>{net > 0 ? '+' : ''}{net}</strong><small>this year</small></div>
      </div>
      <div className="report-panels">
        <div>
          <h4>Behaviour behind the points</h4>
          <ul>
            {b.positives.slice(0, 4).map((c) => (
              <li key={`p-${c.name}`}><span>{c.name} <span style={muted}>×{c.count}</span></span><strong style={{ color: '#1a7a3d' }}>+{c.points}</strong></li>
            ))}
            {b.negatives.map((c) => (
              <li key={`n-${c.name}`}><span>{c.name} <span style={muted}>×{c.count}</span></span><strong style={{ color: '#b3282d' }}>{c.points}</strong></li>
            ))}
            {b.positives.length === 0 && b.negatives.length === 0 && <li style={muted}>No behaviour points yet this year.</li>}
          </ul>
        </div>
        <div>
          <h4>Best grades</h4>
          <ul>{best.length ? best.map(gradeRow) : <li style={muted}>No grades yet this year.</li>}</ul>
          {weakest.length > 0 && (
            <>
              <h4>Weakest grades</h4>
              <ul>{weakest.map(gradeRow)}</ul>
            </>
          )}
          <p style={{ ...muted, fontSize: '0.75rem', margin: 0 }}>Latest grade in each subject this year.</p>
        </div>
      </div>
      <div className="report-panels-single">
        <h4>Grades from subject teachers{subjectCount ? ` (${subjectCount} subject${subjectCount === 1 ? '' : 's'} so far)` : ''}</h4>
        {subjectCount === 0 ? (
          <p style={{ ...muted, fontSize: '0.85rem', margin: 0 }}>No subject teacher has entered grades for this report yet.</p>
        ) : JUDGEMENTS.map((j) => (
          <div key={j.key} className="report-judgement-row">
            <span>{j.label}</span>
            {JUDGEMENT_GRADES.filter((g) => judgements[j.key][g]).map((g) => (
              <span key={g} className={`report-count${g === 'Needs Improvement' ? ' warn' : ''}`}><strong>{judgements[j.key][g]}</strong> × {g}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WritePastoralCommentsPage() {
  return <RequireAuth><RequireResource resourceKey="/reports/write-pastoral-comments"><WritePastoralCommentsInner /></RequireResource></RequireAuth>;
}
