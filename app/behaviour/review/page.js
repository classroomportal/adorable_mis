'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import EventCommentEditor from '../../components/EventCommentEditor';

// A "serious" behaviour event is negative with -5 points (migration 166; 106 and 135 used -4 and -3).
// It can't be saved without an explanation, but it stays hidden from the
// parent portal until someone here confirms it follows school protocol, names
// no other student, and reads clearly — then releases it with the toggle.
// The office can correct the explanation here themselves (migration 211). An
// event they keep hidden stays listed under "Kept hidden" until it's
// released, rather than dropping into history with no way back to it.
//
// The picture and the text are two separate decisions. A serious event with a
// picture carries both on its own card: approve or decline the picture
// (review_behaviour_photo), and release or keep back the text
// (review_serious_behaviour_event), in either order and independently. Parents
// only ever see an approved picture on an event whose text has been released
// (RLS on behaviour_photos), so declining the text holds the picture back too.
// Pictures on other events are listed on their own under "Pictures to check".
const PICTURE_STATUS = { pending: 'Waiting', approved: 'Approved', rejected: 'Declined' };

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
  // Pictures added to behaviour events (migration 209), waiting for approval
  // before parents can see them: [{ photo, events: [...] }]. Pictures on a
  // serious event still waiting to be released are left out: they're
  // reviewed on that event's own card.
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(null);

  async function load() {
    setLoading(true);
    const [{ data: s }, { data: p }, { data: h }] = await Promise.all([
      supabase.from('students').select('student_id, first_name, last_name').eq('status', 'active'),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, type, category, points, description, student_id, staff_id, photo_id, protocol_reviewed_at, students(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name), photo:behaviour_photos(photo_id, status, image_jpeg_base64)')
        .eq('type', 'negative')
        .lte('points', -5)
        .eq('visible_to_parents', false)
        .is('voided_at', null)
        .order('event_date', { ascending: false }),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, category, points, visible_to_parents, protocol_reviewed_at, students(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name), reviewer:staff!behaviour_events_protocol_reviewed_by_fkey(first_name, last_name), photo:behaviour_photos(status)')
        .eq('type', 'negative')
        .lte('points', -5)
        .not('protocol_reviewed_at', 'is', null)
        .order('protocol_reviewed_at', { ascending: false })
        .limit(30),
    ]);
    setStudents(s || []);
    setPending(p || []);
    setHistory(h || []);
    await loadPhotos();
    setLoading(false);
  }

  async function loadPhotos() {
    const { data: photos } = await supabase
      .from('behaviour_photos')
      .select('photo_id, image_jpeg_base64, created_at, uploader:staff!behaviour_photos_uploaded_by_fkey(first_name, last_name)')
      .eq('status', 'pending')
      .order('created_at');
    const list = photos || [];
    if (list.length === 0) { setPendingPhotos([]); return; }
    const { data: evs } = await supabase
      .from('behaviour_events')
      .select('event_id, photo_id, event_date, type, category, points, description, visible_to_parents, students(first_name, last_name)')
      .in('photo_id', list.map((ph) => ph.photo_id))
      .is('voided_at', null);
    const onSeriousCard = (e) => e.type === 'negative' && e.points <= -5 && !e.visible_to_parents;
    setPendingPhotos(
      list
        .map((photo) => ({ photo, events: (evs || []).filter((e) => e.photo_id === photo.photo_id) }))
        .filter(({ events }) => !events.some(onSeriousCard))
    );
  }

  async function reviewPhoto(photoId, approve) {
    setPhotoBusy(photoId);
    setStatus(null);
    const { error } = await supabase.rpc('review_behaviour_photo', { p_photo_id: photoId, p_approve: approve });
    setPhotoBusy(null);
    if (error) setStatus(`Error: ${error.message}`);
    else {
      setStatus(approve ? 'Picture approved.' : 'Picture declined — parents won\'t see it.');
      // The picture may be on a serious event's card as well as in the list.
      setPending((list) => list.map((x) => (x.photo?.photo_id === photoId ? { ...x, photo: { ...x.photo, status: approve ? 'approved' : 'rejected' } } : x)));
      loadPhotos();
    }
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
      setStatus('Tick the protocol confirmation before releasing the text to parents.');
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
      setStatus(visibleToParents ? 'Text released to parents.' : 'Text declined — kept from parents. It stays under "Kept hidden" below until it\'s released.');
      load();
    }
  }

  const awaiting = pending.filter((ev) => !ev.protocol_reviewed_at);
  const keptHidden = pending.filter((ev) => ev.protocol_reviewed_at);

  function renderPicture(ev) {
    const ph = ev.photo;
    const decided = ph.status !== 'pending';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-start' }}>
        <strong>Picture</strong>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/jpeg;base64,${ph.image_jpeg_base64}`}
          alt="Picture added with this behaviour event"
          style={{ width: 'min(100%, 360px)', borderRadius: 8, border: '1px solid var(--slate-200)' }}
        />
        <span style={{ fontSize: '0.85em', color: ph.status === 'rejected' ? 'var(--red-700)' : '#666' }}>
          {ph.status === 'pending' && 'Waiting for a decision. Check it shows only what it should and no other student can be identified.'}
          {ph.status === 'approved' && 'Approved. Parents see it once the text is released.'}
          {ph.status === 'rejected' && 'Declined. Parents won\u2019t see it.'}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {ph.status !== 'approved' && (
            <button
              className={decided ? 'secondary' : undefined}
              disabled={photoBusy === ph.photo_id}
              onClick={() => reviewPhoto(ph.photo_id, true)}
              style={{ width: 'fit-content' }}
            >
              {decided ? 'Approve picture instead' : 'Approve picture'}
            </button>
          )}
          {ph.status !== 'rejected' && (
            <button
              className="secondary"
              disabled={photoBusy === ph.photo_id}
              onClick={() => reviewPhoto(ph.photo_id, false)}
              style={{ width: 'fit-content' }}
            >
              {decided ? 'Decline picture instead' : 'Decline picture'}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderSerious(ev) {
    const flagged = mentionsAnotherStudent(ev.description, ev.student_id);
    return (
      <div key={ev.event_id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <strong>{ev.students?.first_name} {ev.students?.last_name}</strong>
          <span>{formatUKDate(ev.event_date)} · {ev.category ?? '—'} · {ev.points} points</span>
        </div>
        <span style={{ fontSize: '0.85em', color: '#666', marginTop: '-0.5rem' }}>
          Logged by {ev.staff ? `${ev.staff.first_name} ${ev.staff.last_name}` : '—'}
        </span>

        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <strong>Text</strong>
            {/* The picture has its own decision alongside, so the editor doesn't show it again. */}
            <EventCommentEditor
              event={{ ...ev, photo_id: null }}
              onSaved={(changes) => {
                setPending((list) => list.map((x) => (x.event_id === ev.event_id ? { ...x, ...changes } : x)));
                // The confirmation was for the old wording.
                setConfirmed((c) => ({ ...c, [ev.event_id]: false }));
              }}
            />
            {flagged && (
              <p style={{ color: '#b45309', fontWeight: 'bold', margin: 0 }}>
                ⚠ This explanation may name another enrolled student — edit it before releasing.
              </p>
            )}
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={!!confirmed[ev.event_id]}
                onChange={(e) => setConfirmed({ ...confirmed, [ev.event_id]: e.target.checked })}
                style={{ flex: '0 0 auto', width: 'auto' }}
              />
              I confirm this follows school behaviour protocol, names no other student, and is written in good English.
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                disabled={busyId === ev.event_id || !confirmed[ev.event_id]}
                onClick={() => review(ev.event_id, true)}
                style={{ width: 'fit-content' }}
              >
                Approve text — release to parents
              </button>
              {!ev.protocol_reviewed_at && (
                <button
                  className="secondary"
                  disabled={busyId === ev.event_id}
                  onClick={() => review(ev.event_id, false)}
                  style={{ width: 'fit-content' }}
                >
                  Decline text — keep hidden
                </button>
              )}
            </div>
          </div>
          {ev.photo && (
            <div style={{ flex: '1 1 240px' }}>
              {renderPicture(ev)}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!canReview) {
    return <p>This page is for school office staff and admin only.</p>;
  }

  return (
    <div>
      <h1>Behaviour Review</h1>
      <p style={{ color: '#555' }}>
        A -5 point event needs checking before parents see it: does the
        explanation follow school protocol, does it avoid naming any other
        student, and is it written in clear, good English? If it needs
        changing, use Edit to correct it yourself, then tick the
        confirmation and release it. If the event has a picture, approve or
        decline the picture separately on the same card. Declining one
        doesn&apos;t decline the other, but a picture only reaches parents
        once the text has been released too.
      </p>

      {status && <p>{status}</p>}

      {loading ? <p>Loading…</p> : (
        <>
          <h2>Pictures to check ({pendingPhotos.length})</h2>
          <p style={{ color: '#555', marginTop: 0 }}>
            Pictures staff added to other behaviour events. Parents only see one once it&apos;s approved here —
            check it shows only what it should and no other student can be identified. This decides the
            picture only, not the event&apos;s text. Pictures on -5 events are checked on the event&apos;s own card below.
          </p>
          {pendingPhotos.length === 0 ? <p>No pictures waiting.</p> : pendingPhotos.map(({ photo, events }) => {
            const first = events[0];
            const names = events.map((e) => `${e.students?.first_name} ${e.students?.last_name}`);
            return (
              <div key={photo.photo_id} className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${photo.image_jpeg_base64}`}
                  alt="Picture waiting for review"
                  style={{ width: 'min(100%, 360px)', borderRadius: 8, border: '1px solid var(--slate-200)' }}
                />
                <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {first ? (
                    <>
                      <strong>
                        {first.category} ({first.points > 0 ? '+' : ''}{first.points}) · {formatUKDate(first.event_date)}
                      </strong>
                      <span>
                        {names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`}
                      </span>
                      {first.description && <span style={{ whiteSpace: 'pre-wrap', color: '#444' }}>{first.description}</span>}
                      <span style={{ fontSize: '0.85em', color: '#666' }}>
                        {first.visible_to_parents
                          ? 'Parents can already see this event\u2019s text. Only the picture is being decided here.'
                          : 'Parents don\u2019t see this event, so they won\u2019t see the picture either. The student will if it\u2019s approved.'}
                      </span>
                    </>
                  ) : <span style={{ color: '#666' }}>Not attached to any event (it may have been withdrawn on appeal).</span>}
                  <span style={{ fontSize: '0.85em', color: '#666' }}>
                    Added by {photo.uploader ? `${photo.uploader.first_name} ${photo.uploader.last_name}` : '—'}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    <button disabled={photoBusy === photo.photo_id} onClick={() => reviewPhoto(photo.photo_id, true)} style={{ width: 'fit-content' }}>
                      Approve picture
                    </button>
                    <button className="secondary" disabled={photoBusy === photo.photo_id} onClick={() => reviewPhoto(photo.photo_id, false)} style={{ width: 'fit-content' }}>
                      Decline picture
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <h2 style={{ marginTop: '1.5rem' }}>Serious events awaiting review ({awaiting.length})</h2>
          {awaiting.length === 0 ? <p>Nothing waiting.</p> : awaiting.map((ev) => renderSerious(ev))}

          {keptHidden.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Kept hidden ({keptHidden.length})</h2>
              <p style={{ color: '#555', marginTop: 0 }}>
                Reviewed but not yet shown to parents. Correct the explanation, then release it.
              </p>
              {keptHidden.map((ev) => renderSerious(ev))}
            </>
          )}

          <h2 style={{ marginTop: '1.5rem' }}>Recently reviewed</h2>
          {history.length === 0 ? <p>None yet.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Reviewed by</th><th>Text shown to parents</th><th>Picture</th></tr></thead>
              <tbody>
                {history.map((ev) => (
                  <tr key={ev.event_id}>
                    <td>{formatUKDate(ev.event_date)}</td>
                    <td>{ev.students?.first_name} {ev.students?.last_name}</td>
                    <td>{ev.category ?? '—'}</td>
                    <td>{ev.points}</td>
                    <td>{ev.reviewer ? `${ev.reviewer.first_name} ${ev.reviewer.last_name}` : '—'}</td>
                    <td>{ev.visible_to_parents ? 'Yes' : 'No'}</td>
                    <td>{PICTURE_STATUS[ev.photo?.status] ?? '—'}</td>
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
