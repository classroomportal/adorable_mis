'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';
import { generateTranscript } from '../../lib/generateTranscript';

function PortalInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const [results, setResults] = useState([]);
  const [targets, setTargets] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [gradePoints, setGradePoints] = useState({});
  const [appealForm, setAppealForm] = useState(null); // event_id being appealed
  const [appealReason, setAppealReason] = useState('');
  const [status, setStatus] = useState(null);

  async function load() {
    if (!studentId) return;
    const { data: r } = await supabase.from('results').select('*, subjects(subject_name, display_name)').eq('student_id', studentId).order('week_start_date', { ascending: false });
    setResults(r || []);
    const { data: tg } = await supabase.from('target_grades').select('subject_id, target_grade, subjects(subject_name, display_name)').eq('student_id', studentId);
    setTargets(tg || []);
    const { data: gs } = await supabase.from('grade_scale').select('*');
    setGradePoints(Object.fromEntries((gs || []).map((g) => [g.grade, Number(g.points)])));
    const { data: b } = await supabase.from('behaviour_events').select('*').eq('student_id', studentId).order('event_date', { ascending: false });
    setBehaviour(b || []);
    const { data: ap } = await supabase.from('behaviour_appeals').select('*').eq('student_id', studentId);
    setAppeals(ap || []);
  }

  useEffect(() => { load(); }, [studentId]);

  function appealFor(eventId) {
    const existing = appeals.find((a) => a.event_id === eventId);
    return existing;
  }

  async function submitAppeal(eventId) {
    if (!appealReason.trim()) { setStatus('Please explain why you are appealing.'); return; }
    const { error } = await supabase.from('behaviour_appeals').insert({
      event_id: eventId, student_id: studentId, reason: appealReason.trim(),
    });
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Appeal submitted — your pastoral manager will review it.'); setAppealForm(null); setAppealReason(''); load(); }
  }

  if (!studentId) {
    return <p>Your account isn't linked to a student record yet — ask the school office to link it.</p>;
  }

  const STATUS_LABEL = { pending: 'Pending review', upheld: 'Appeal upheld', rejected: 'Appeal rejected' };

  return (
    <div>
      <h1>My Grades & Behaviour</h1>
      <button onClick={() => generateTranscript(studentId)}>📄 Download Transcript</button>

      <div className="card">
        <h2>Results vs Target</h2>
        {targets.length === 0 ? <p>No target grades set yet.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Subject</th><th>Target</th><th>Most recent grade</th></tr></thead>
            <tbody>
              {targets.map((t) => {
                const latest = results.find((r) => r.subject_id === t.subject_id);
                return (
                  <tr key={t.subject_id}>
                    <td>{t.subjects?.display_name || t.subjects?.subject_name}</td>
                    <td>{t.target_grade}</td>
                    <td>{latest?.grade ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th></th></tr></thead>
            <tbody>
              {behaviour.map((b) => {
                const existingAppeal = appealFor(b.event_id);
                return (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>{b.category}</td>
                    <td>{b.points}</td>
                    <td>
                      {b.type !== 'negative' ? '' : existingAppeal ? (
                        <span style={{ fontSize: '0.85rem' }}>{STATUS_LABEL[existingAppeal.status]}</span>
                      ) : appealForm === b.event_id ? (
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                          <input
                            placeholder="Why are you appealing?"
                            value={appealReason}
                            onChange={(e) => setAppealReason(e.target.value)}
                            style={{ width: '12rem' }}
                          />
                          <button onClick={() => submitAppeal(b.event_id)}>Submit</button>
                          <button className="secondary" onClick={() => { setAppealForm(null); setAppealReason(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="secondary" onClick={() => setAppealForm(b.event_id)}>Appeal</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {status && <p>{status}</p>}
      </div>
    </div>
  );
}

export default function PortalPage() {
  return <RequireAuth><PortalInner /></RequireAuth>;
}
