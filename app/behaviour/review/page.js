'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';

// A "serious" behaviour event is negative with -3 to -5 points (migrations 106, 135).
// It can't be saved without an explanation, but it stays hidden from the
// parent portal until someone here confirms it follows school protocol, names
// no other student, and reads clearly — then releases it with the toggle.
function ReviewInner() {
  const { profile, staffRoles } = useAuth();
  const canReview = profile?.role === 'admin' || (staffRoles || []).includes('school_office');

  const [students, setStudents] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState({}); // event_id -> boolean
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState(null);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: p }, { data: h }] = await Promise.all([
      supabase.from('students').select('student_id, first_name, last_name').eq('status', 'active'),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, category, points, description, student_id, students(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name)')
        .eq('type', 'negative')
        .lte('points', -3)
        .eq('visible_to_parents', false)
        .is('protocol_reviewed_at', null)
        .order('event_date', { ascending: false }),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, category, points, visible_to_parents, protocol_reviewed_at, students(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name), reviewer:staff!behaviour_events_protocol_reviewed_by_fkey(first_name, last_name)')
        .eq('type', 'negative')
        .lte('points', -3)
        .not('protocol_reviewed_at', 'is', null)
        .order('protocol_reviewed_at', { ascending: false })
        .limit(30),
    ]);
    setStudents(s || []);
    setPending(p || []);
    setHistory(h || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Soft warning only — a human still has to read the explanation, but this
  // surfaces the most obvious case (another enrolled student's full name
  // appearing in the text) so it doesn't get missed.
  function mentionsAnotherStudent(text, ownStudentId) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return students.some((s) => {
      if (s.student_id === ownStudentId) return false;
      const full = `${s.first_name} ${s.last_name}`.trim().toLowerCase();
      return full.length >= 5 && lower.includes(full);
    });
  }

  async function review(eventId, visibleToParents) {
    if (visibleToParents && !confirmed[eventId]) {
      setStatus('Tick the protocol confirmation before releasing this event to parents.');
      return;
    }
    setBusyId(eventId);
    setStatus(null);
    const { error } = await supabase.rpc('review_serious_behaviour_event', {
      p_event_id: eventId,
      p_visible_to_parents: visibleToParents,
      p_protocol_confirmed: !!confirmed[eventId],
    });
    setBusyId(null);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(visibleToParents ? 'Released to parents.' : 'Kept hidden from parents.');
      load();
    }
  }

  if (!canReview) {
    return <p>This page is for school office staff and admin only.</p>;
  }

  return (
    <div>
      <h1>Review Serious Behaviour Events</h1>
      <p style={{ color: '#555' }}>
        A -3 to -5 point event needs checking before parents see it: does the
        explanation follow school protocol, does it avoid naming any other
        student, and is it written in clear, good English? Tick the
        confirmation and release it, or leave it hidden if it needs the
        writer to redo it.
      </p>

      {status && <p>{status}</p>}

      {loading ? <p>Loading…</p> : (
        <>
          <h2>Awaiting review ({pending.length})</h2>
          {pending.length === 0 ? <p>Nothing waiting.</p> : (
            <div className="table-scroll">
              {pending.map((ev) => {
                const flagged = mentionsAnotherStudent(ev.description, ev.student_id);
                return (
                  <div key={ev.event_id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <strong>{ev.students?.first_name} {ev.students?.last_name}</strong>
                      <span>{formatUKDate(ev.event_date)} · {ev.category ?? '—'} · {ev.points} points</span>
                    </div>
                    <p style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap' }}>{ev.description}</p>
                    <p style={{ fontSize: '0.85em', color: '#666' }}>
                      Logged by {ev.staff ? `${ev.staff.first_name} ${ev.staff.last_name}` : '—'}
                    </p>
                    {flagged && (
                      <p style={{ color: '#b45309', fontWeight: 'bold' }}>
                        ⚠ This explanation may name another enrolled student — check carefully before releasing.
                      </p>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={!!confirmed[ev.event_id]}
                        onChange={(e) => setConfirmed({ ...confirmed, [ev.event_id]: e.target.checked })}
                        style={{ flex: '0 0 auto', width: 'auto' }}
                      />
                      I confirm this follows school behaviour protocol, names no other student, and is written in good English.
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        disabled={busyId === ev.event_id || !confirmed[ev.event_id]}
                        onClick={() => review(ev.event_id, true)}
                        style={{ width: 'fit-content' }}
                      >
                        Release to parents
                      </button>
                      <button
                        className="secondary"
                        disabled={busyId === ev.event_id}
                        onClick={() => review(ev.event_id, false)}
                        style={{ width: 'fit-content' }}
                      >
                        Keep hidden (needs rewriting)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2 style={{ marginTop: '1.5rem' }}>Recently reviewed</h2>
          {history.length === 0 ? <p>None yet.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Reviewed by</th><th>Visible to parents</th></tr></thead>
              <tbody>
                {history.map((ev) => (
                  <tr key={ev.event_id}>
                    <td>{formatUKDate(ev.event_date)}</td>
                    <td>{ev.students?.first_name} {ev.students?.last_name}</td>
                    <td>{ev.category ?? '—'}</td>
                    <td>{ev.points}</td>
                    <td>{ev.reviewer ? `${ev.reviewer.first_name} ${ev.reviewer.last_name}` : '—'}</td>
                    <td>{ev.visible_to_parents ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  );
}

export default function BehaviourReviewPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/behaviour/review">
      <ReviewInner />
    </RequireResource></RequireAuth>
  );
}
