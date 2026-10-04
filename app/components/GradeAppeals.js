'use client';

// A student's mark appeals (migration 354), on the Assessment page of the
// portal. Marks from the last few days can be appealed when they don't match
// the marked paper; the teacher checks the paper and decides. Credits:
// an appeal that is turned down uses one, an upheld or withdrawn appeal gives
// it back. All the rules are in the database (appeal_grade() and friends);
// this only shows them.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';

const STATUS = {
  pending: 'Waiting for your teacher',
  upheld: 'Upheld: mark corrected',
  turned_down: 'Turned down: mark stands',
  withdrawn: 'Withdrawn',
};

const heading = { margin: '1rem 0 0.25rem', fontSize: '1rem' };
const note = { margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#5b6472' };

function markText(score, max, grade) {
  const parts = [];
  if (score != null) parts.push(max != null ? `${Number(score)} / ${Number(max)}` : `${Number(score)}`);
  if (grade) parts.push(score != null ? `(${grade})` : grade);
  return parts.join(' ') || '—';
}

export default function GradeAppeals({ studentId }) {
  const [marks, setMarks] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [credits, setCredits] = useState(null);
  const [form, setForm] = useState(null); // result_id being appealed
  const [claimed, setClaimed] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(null);
  // Slow-network double taps: the ref stops a second submit before React re-renders.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const [{ data: m }, { data: c }, { data: a }] = await Promise.all([
      supabase.rpc('my_appealable_marks'),
      supabase.rpc('my_grade_appeal_credits'),
      supabase
        .from('grade_appeals')
        .select('appeal_id, status, created_at, decided_at, score_appealed, max_score_appealed, grade_appealed, claimed_score, reason, decision_note, new_score, new_grade, subjects(subject_name, display_name), calendar_events(event_name)')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false }),
    ]);
    setMarks(m || []);
    setCredits((c || [])[0] || null);
    setAppeals(a || []);
  }

  useEffect(() => { if (studentId) load(); }, [studentId]);

  function closeForm() { setForm(null); setClaimed(''); setReason(''); }

  async function submit(resultId) {
    if (!reason.trim()) { setStatus('Please explain why you think the mark is wrong.'); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    let error;
    try {
      ({ error } = await supabase.rpc('appeal_grade', {
        p_result_id: resultId,
        p_claimed_score: claimed === '' ? null : Number(claimed),
        p_reason: reason.trim(),
      }));
    } catch (err) {
      error = err;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (error) { setStatus(error.message); return; }
    setStatus('Appeal sent to your teacher. You will get a message in your inbox when they have decided.');
    closeForm();
    load();
  }

  async function withdraw(appealId) {
    if (!window.confirm('Withdraw this appeal? Your credit is given back.')) return;
    const { error } = await supabase.rpc('withdraw_grade_appeal', { p_appeal_id: appealId });
    if (error) setStatus(error.message);
    else { setStatus('Appeal withdrawn.'); load(); }
  }

  const left = credits?.credits_left ?? 0;
  const days = credits?.days ?? 5;

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h3 style={heading}>Appeal a mark</h3>
      <p style={note}>
        If a mark here doesn't match your marked paper, you can appeal it within {days} days of it appearing.
        Your teacher checks your paper. An appeal that is turned down uses one of your credits;
        if it is upheld, you get the credit back.
      </p>
      {credits && (
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Credits left this year: {left} of {credits.credits}</strong>
          {credits.held > 0 && <span style={note}> ({credits.held} held by appeals waiting for a decision)</span>}
        </p>
      )}
      {status && <p>{status}</p>}

      {marks.length === 0 ? (
        <p style={note}>No marks from the last {days} days.</p>
      ) : (
        <div className="table-scroll"><table>
          <thead><tr><th>Subject</th><th>Result set</th><th>Mark</th><th>Appeal by</th><th></th></tr></thead>
          <tbody>
            {marks.map((m) => (
              <tr key={m.result_id}>
                <td>{m.subject_name}</td>
                <td>{m.result_set_name}</td>
                <td>{markText(m.score, m.max_score, m.grade)}</td>
                <td>{formatUKDate(m.closes_on)}</td>
                <td>
                  {!m.can_appeal ? (
                    <span style={{ fontSize: '0.85rem' }}>{STATUS[m.appeal_status] || 'Appealed'}</span>
                  ) : form === m.result_id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '14rem' }}>
                      {m.score != null && (
                        <label style={{ fontSize: '0.85rem' }}>
                          Mark on my paper (optional){' '}
                          <input
                            type="number" min="0" max={m.max_score ?? undefined} step="any"
                            value={claimed} onChange={(e) => setClaimed(e.target.value)}
                            style={{ width: '5rem' }}
                          />
                        </label>
                      )}
                      <textarea
                        placeholder="Why do you think the mark is wrong?"
                        value={reason} onChange={(e) => setReason(e.target.value)}
                        maxLength={1000} rows={2}
                      />
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => submit(m.result_id)} disabled={submitting}>{submitting ? 'Sending…' : 'Send appeal'}</button>
                        <button className="secondary" onClick={closeForm}>Cancel</button>
                      </div>
                    </div>
                  ) : left > 0 ? (
                    <button className="secondary" onClick={() => { closeForm(); setStatus(null); setForm(m.result_id); }}>Appeal</button>
                  ) : (
                    <span style={note}>No credits left</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {appeals.length > 0 && (
        <>
          <h3 style={heading}>My appeals</h3>
          <div className="table-scroll"><table>
            <thead><tr><th>Sent</th><th>Subject</th><th>Mark appealed</th><th>Your reason</th><th>Outcome</th><th></th></tr></thead>
            <tbody>
              {appeals.map((a) => (
                <tr key={a.appeal_id}>
                  <td>{formatUKDate(a.created_at.slice(0, 10))}</td>
                  <td>
                    {a.subjects?.display_name || a.subjects?.subject_name}
                    {a.calendar_events?.event_name && <div style={note}>{a.calendar_events.event_name}</div>}
                  </td>
                  <td>
                    {markText(a.score_appealed, a.max_score_appealed, a.grade_appealed)}
                    {a.claimed_score != null && <div style={note}>Paper: {Number(a.claimed_score)}</div>}
                  </td>
                  <td>{a.reason}</td>
                  <td>
                    {STATUS[a.status]}
                    {a.status === 'upheld' && <div style={note}>Now {markText(a.new_score, a.max_score_appealed, a.new_grade)}</div>}
                    {a.decision_note && <div style={note}>{a.decision_note}</div>}
                  </td>
                  <td>
                    {a.status === 'pending' && <button className="secondary" onClick={() => withdraw(a.appeal_id)}>Withdraw</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}
