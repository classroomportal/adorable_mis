'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { useAuth } from '../../lib/AuthContext';
import { formatUKDate } from '../../lib/formatDate';

function AppealsInner() {
  const { isPastoralOrSmt } = useAuth();
  const [appeals, setAppeals] = useState([]);
  const [notes, setNotes] = useState({}); // appeal_id -> draft resolution note
  const [status, setStatus] = useState(null);

  async function load() {
    const { data } = await supabase
      .from('behaviour_appeals')
      .select('*, students(first_name,last_name), reviewer:staff!behaviour_appeals_reviewed_by_fkey(first_name, last_name), behaviour_events(event_date, category, points, voided_points, voided_at, description, staff!behaviour_events_staff_id_fkey(first_name, last_name)))')
      .order('created_at', { ascending: false });
    setAppeals(data || []);
  }

  useEffect(() => { load(); }, []);

  // Who recorded the event being appealed. behaviour_events has two FKs to
  // staff, so the embed in load() names staff_id's constraint explicitly.
  function awardedBy(a) {
    const s = a.behaviour_events?.staff;
    return s ? `${s.first_name} ${s.last_name}` : '—';
  }

  // The event as it was given. An upheld appeal zeroes the event's points but
  // keeps the original in voided_points (migration 222), so the negative that
  // was withdrawn is still shown here.
  function eventCell(a) {
    const e = a.behaviour_events;
    if (!e) return '—';
    const pts = e.voided_at ? e.voided_points : e.points;
    return (
      <>
        {formatUKDate(e.event_date, { weekday: true })} — {e.category}{pts != null ? ` (${pts})` : ''}
        {e.description && <div style={{ fontSize: '0.85em', color: 'var(--ink-soft)' }}>{e.description}</div>}
      </>
    );
  }

  function outcome(a) {
    if (a.status === 'upheld') return 'Upheld — negative withdrawn';
    if (a.status === 'rejected') return 'Rejected — negative stands';
    return a.status;
  }

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
            <thead><tr><th>Student</th><th>Event</th><th>Awarded by</th><th>Reason for appeal</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.appeal_id}>
                  <td>{a.students?.first_name} {a.students?.last_name}</td>
                  <td>{eventCell(a)}</td>
                  <td>{awardedBy(a)}</td>
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
            <thead><tr><th>Student</th><th>Event</th><th>Awarded by</th><th>Reason for appeal</th><th>Outcome</th><th>Resolution notes</th></tr></thead>
            <tbody>
              {resolved.map((a) => (
                <tr key={a.appeal_id}>
                  <td>{a.students?.first_name} {a.students?.last_name}</td>
                  <td>{eventCell(a)}</td>
                  <td>{awardedBy(a)}</td>
                  <td>{a.reason}</td>
                  <td>
                    {outcome(a)}
                    {(a.reviewer || a.reviewed_at) && (
                      <div style={{ fontSize: '0.85em', color: 'var(--ink-soft)' }}>
                        {a.reviewer ? `${a.reviewer.first_name} ${a.reviewer.last_name}` : ''}
                        {a.reviewer && a.reviewed_at ? ', ' : ''}
                        {a.reviewed_at ? formatUKDate(a.reviewed_at.slice(0, 10)) : ''}
                      </div>
                    )}
                  </td>
                  <td>{a.resolution_notes || '—'}</td>
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
  return <RequireAuth><RequireResource resourceKey="/appeals"><AppealsInner /></RequireResource></RequireAuth>;
}
