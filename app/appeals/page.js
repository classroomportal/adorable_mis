'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';

function AppealsInner() {
  const { isPastoralOrSmt } = useAuth();
  const [appeals, setAppeals] = useState([]);
  const [notes, setNotes] = useState({}); // appeal_id -> draft resolution note
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase
      .from('behaviour_appeals')
      .select('*, students(first_name,last_name), behaviour_events(event_date, category, points, description)')
      .order('created_at', { ascending: false });
    setAppeals(data || []);
  }

  useEffect(() => { load(); }, []);

  async function resolve(appealId, newStatus) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('staff_id').eq('id', userData.user.id).single();
    const { error } = await supabase.from('behaviour_appeals').update({
      status: newStatus,
      reviewed_by: profile?.staff_id || null,
      reviewed_at: new Date().toISOString(),
      resolution_notes: notes[appealId] || null,
    }).eq('appeal_id', appealId);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Updated.'); load(); }
  }

  if (!isPastoralOrSmt) return <p>Only Pastoral/SMT staff can review appeals.</p>;

  const pending = appeals.filter((a) => a.status === 'pending');
  const resolved = appeals.filter((a) => a.status !== 'pending');

  return (
    <div>
      <h1>Behaviour Appeals</h1>
      {status && <p>{status}</p>}

      <div className="card">
        <h2>Pending ({pending.length})</h2>
        {pending.length === 0 ? <p>No appeals waiting for review.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Event</th><th>Reason for appeal</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.appeal_id}>
                  <td>{a.students?.first_name} {a.students?.last_name}</td>
                  <td>{a.behaviour_events?.event_date} — {a.behaviour_events?.category} ({a.behaviour_events?.points})</td>
                  <td>{a.reason}</td>
                  <td>
                    <input
                      placeholder="Resolution notes (optional)"
                      value={notes[a.appeal_id] || ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [a.appeal_id]: e.target.value }))}
                      style={{ width: '12rem' }}
                    />
                  </td>
                  <td style={{ display: 'flex', gap: '0.4rem' }}>
                    <button onClick={() => resolve(a.appeal_id, 'upheld')}>Uphold</button>
                    <button className="secondary" onClick={() => resolve(a.appeal_id, 'rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Resolved</h2>
        {resolved.length === 0 ? <p>None yet.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Event</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {resolved.map((a) => (
                <tr key={a.appeal_id}>
                  <td>{a.students?.first_name} {a.students?.last_name}</td>
                  <td>{a.behaviour_events?.event_date} — {a.behaviour_events?.category}</td>
                  <td>{a.status}</td>
                  <td>{a.resolution_notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function AppealsPage() {
  return <RequireAuth><AppealsInner /></RequireAuth>;
}
