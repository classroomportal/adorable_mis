'use client';

// Mark appeals (migration 354). A student appeals a mark they think doesn't
// match their marked paper; their teacher for that subject checks the paper
// and either corrects the mark (upheld) or says why it stands (turned down).
// Only the teacher decides (the principal, 4 Oct 2026); SMT, assessment
// managers and admins see every appeal here but can't decide them.
// decide_grade_appeal() makes the change, so it is in Grade History under
// the teacher's name.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';

const OUTCOME = {
  upheld: 'Upheld: mark corrected',
  turned_down: 'Turned down: mark stands',
  withdrawn: 'Withdrawn by the student',
};

const soft = { fontSize: '0.85em', color: 'var(--ink-soft)' };

function markText(score, max, grade) {
  const parts = [];
  if (score != null) parts.push(max != null ? `${Number(score)} / ${Number(max)}` : `${Number(score)}`);
  if (grade) parts.push(score != null ? `(${grade})` : grade);
  return parts.join(' ') || '—';
}

function name(p) {
  return p ? `${p.first_name} ${p.last_name}` : '—';
}

function GradeAppealsInner() {
  const { profile } = useAuth();
  const staffId = profile?.staff_id;
  const [appeals, setAppeals] = useState([]);
  const [mine, setMine] = useState(new Set()); // "student:subject" pairs this teacher teaches
  const [drafts, setDrafts] = useState({}); // appeal_id -> { score, grade, note }
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(null); // academic_years.grade_appeal_days

  async function load() {
    const { data, error } = await supabase
      .from('grade_appeals')
      .select('*, students(first_name, last_name, year_group), subjects(subject_name, display_name), calendar_events(event_name), results(score, max_score, grade), decider:staff(first_name, last_name)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setStatus(`Error: ${error.message}`);
    setAppeals(data || []);
    const { data: year } = await supabase.from('academic_years').select('grade_appeal_days').eq('status', 'current').maybeSingle();
    setDays(year?.grade_appeal_days ?? null);

    // Which appeals this person can decide: students in their own classes,
    // the same rule as teaches_student_for_subject() in the database.
    if (staffId) {
      const { data: classes } = await supabase
        .from('classes')
        .select('subject_id, student_class(student_id)')
        .eq('staff_id', staffId);
      setMine(new Set((classes || []).flatMap((c) => (c.student_class || []).map((sc) => `${sc.student_id}:${c.subject_id}`))));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [staffId]);

  function setDraft(id, field, value) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));
  }

  async function decide(a, upheld) {
    const d = drafts[a.appeal_id] || {};
    if (!upheld && !(d.note || '').trim()) {
      setStatus('Please write a note saying why the mark stands; the student will see it.');
      return;
    }
    setBusy(a.appeal_id);
    const { error } = await supabase.rpc('decide_grade_appeal', {
      p_appeal_id: a.appeal_id,
      p_upheld: upheld,
      p_new_score: upheld && d.score !== undefined && d.score !== '' ? Number(d.score) : null,
      p_new_grade: upheld && d.grade ? d.grade : null,
      p_note: d.note || null,
    });
    setBusy(null);
    if (error) { setStatus(error.message); return; }
    setStatus(upheld ? 'Upheld: the mark has been corrected and the student told.' : 'Turned down: the student has been told.');
    load();
  }

  const pending = appeals.filter((a) => a.status === 'pending');
  const decided = appeals.filter((a) => a.status !== 'pending');

  function appealCells(a) {
    return (
      <>
        <td>
          {name(a.students)}
          {a.students?.year_group != null && <div style={soft}>Year {a.students.year_group}</div>}
        </td>
        <td>
          {a.subjects?.display_name || a.subjects?.subject_name}
          {a.calendar_events?.event_name && <div style={soft}>{a.calendar_events.event_name}</div>}
        </td>
        <td>
          {markText(a.score_appealed, a.max_score_appealed, a.grade_appealed)}
          {a.claimed_score != null && <div style={soft}>Student says paper shows {Number(a.claimed_score)}</div>}
        </td>
        <td>{a.reason}</td>
      </>
    );
  }

  return (
    <div>
      <h1>Mark Appeals</h1>
      <p style={soft}>
        A student can appeal a mark within {days ?? 'a few'} days of it appearing if it doesn't match their marked paper.
        Check the paper: if the mark was entered wrongly, enter the correct score and uphold; the mark is
        changed and recorded in Grade History. If it is right, turn the appeal down with a short note.
        Only the student&apos;s teacher for the subject can decide.
      </p>
      {status && <p>{status}</p>}

      <div className="card">
        <h2>Waiting for a decision ({pending.length})</h2>
        {loading ? <p>Loading…</p> : pending.length === 0 ? <p>No appeals waiting.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Subject</th><th>Mark appealed</th><th>Reason</th><th>Sent</th><th>Decision</th></tr></thead>
            <tbody>
              {pending.map((a) => {
                const d = drafts[a.appeal_id] || {};
                const canDecide = mine.has(`${a.student_id}:${a.subject_id}`);
                const changedSince = a.results && (Number(a.results.score) !== Number(a.score_appealed) || a.results.grade !== a.grade_appealed);
                return (
                  <tr key={a.appeal_id}>
                    {appealCells(a)}
                    <td>{formatUKDate(a.created_at.slice(0, 10))}</td>
                    <td style={{ minWidth: '15rem' }}>
                      {changedSince && (
                        <div style={soft}>Already changed to {markText(a.results.score, a.results.max_score, a.results.grade)}</div>
                      )}
                      {!canDecide ? (
                        <span style={soft}>For the student&apos;s teacher to decide.</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {a.score_appealed != null ? (
                            <label style={{ fontSize: '0.85rem' }}>
                              Correct score{' '}
                              <input
                                type="number" min="0" max={a.max_score_appealed ?? undefined} step="any"
                                value={d.score ?? ''} onChange={(e) => setDraft(a.appeal_id, 'score', e.target.value)}
                                style={{ width: '5rem' }}
                              />
                            </label>
                          ) : (
                            <label style={{ fontSize: '0.85rem' }}>
                              Correct grade{' '}
                              <input value={d.grade ?? ''} onChange={(e) => setDraft(a.appeal_id, 'grade', e.target.value)} style={{ width: '4rem' }} />
                            </label>
                          )}
                          <input
                            placeholder="Note to the student (needed to turn down)"
                            value={d.note ?? ''} onChange={(e) => setDraft(a.appeal_id, 'note', e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button onClick={() => decide(a, true)} disabled={busy === a.appeal_id}>Uphold</button>
                            <button className="secondary" onClick={() => decide(a, false)} disabled={busy === a.appeal_id}>Turn down</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Decided</h2>
        {loading ? <p>Loading…</p> : decided.length === 0 ? <p>None yet.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Subject</th><th>Mark appealed</th><th>Reason</th><th>Outcome</th></tr></thead>
            <tbody>
              {decided.map((a) => (
                <tr key={a.appeal_id}>
                  {appealCells(a)}
                  <td>
                    {OUTCOME[a.status]}
                    {a.status === 'upheld' && <div style={soft}>Now {markText(a.new_score, a.max_score_appealed, a.new_grade)}</div>}
                    {a.decision_note && <div style={soft}>{a.decision_note}</div>}
                    <div style={soft}>
                      {a.decider ? `${name(a.decider)}, ` : ''}{a.decided_at ? formatUKDate(a.decided_at.slice(0, 10)) : ''}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function GradeAppealsPage() {
  return <RequireAuth><RequireResource resourceKey="/grade-appeals"><GradeAppealsInner /></RequireResource></RequireAuth>;
}
