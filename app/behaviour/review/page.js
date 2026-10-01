'use client';
import { useEffect, useState } from 'react';
import { loadBehaviourRules, useBehaviourRules } from '../../../lib/behaviourRules';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import EventCommentEditor from '../../components/EventCommentEditor';

// What gets checked here before parents see it (migrations 238-239):
//   - any event with a picture (migration 209): SMT and admin;
//   - a -5 event without a picture: the school office and admin. Its text
//     can't be saved without an explanation, and stays hidden until someone
//     here confirms it follows school protocol, names no other student, and
//     reads clearly.
// Each reviewer only sees their own cards.
// The text and the picture are decided separately on one card: send the text
// with the picture, send it without, or edit the text first and then send.
// An event with a picture can be sent whatever its points; a -1 to -4 event
// without one still never reaches parents. On a positive event the text is
// already shown, so only the picture is decided. Parents see a picture only
// on an event whose text they can see. A -5 event kept back stays under
// "Kept hidden" until it's sent, rather than dropping into history with no way
// back to it. review_behaviour_for_parents() enforces all of this.
const EVENT_FIELDS = 'event_id, event_date, type, category, points, description, student_id, staff_id, photo_id, visible_to_parents, protocol_reviewed_at, students!behaviour_events_student_id_fkey(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name)';

const PICTURE_STATUS = { pending: 'Waiting', approved: 'Sent', rejected: 'Not sent' };

// Beyond this many students on one picture (a whole boarding house), the
// comments are shown once rather than with an editor each.
const MAX_EDITORS = 5;

function fullName(p) {
  return p ? `${p.first_name} ${p.last_name}` : '—';
}

function ReviewInner() {
  const { profile, staffRoles } = useAuth();
  const roles = staffRoles || [];
  const isAdmin = profile?.role === 'admin'; // as is_admin() decides it
  const reviewsPictures = isAdmin || roles.includes('smt');
  const reviewsText = isAdmin || roles.includes('school_office');
  const canReview = reviewsPictures || reviewsText;

  const [students, setStudents] = useState([]);
  // Cards: { key, events: [...], photo: { photo_id, status, image_jpeg_base64, uploader } | null }
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState({}); // item key -> boolean
  const [busyKey, setBusyKey] = useState(null);
  const [status, setStatus] = useState(null);
  const { serious_event_points: seriousPoints } = useBehaviourRules();

  async function load() {
    setLoading(true);
    const rules = await loadBehaviourRules();
    const [{ data: s }, { data: photos }, { data: serious }, { data: h }] = await Promise.all([
      supabase.from('students').select('student_id, first_name, last_name').eq('status', 'active'),
      supabase
        .from('behaviour_photos')
        .select('photo_id, status, image_jpeg_base64, created_at, uploader:staff!behaviour_photos_uploaded_by_fkey(first_name, last_name)')
        .eq('status', 'pending')
        .order('created_at'),
      supabase
        .from('behaviour_events')
        .select(`${EVENT_FIELDS}, photo:behaviour_photos(photo_id, status, image_jpeg_base64)`)
        .eq('type', 'negative')
        .lte('points', rules.serious_event_points)
        .eq('visible_to_parents', false)
        .is('voided_at', null)
        .order('event_date', { ascending: false }),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, category, points, visible_to_parents, protocol_reviewed_at, students!behaviour_events_student_id_fkey(first_name, last_name), reviewer:staff!behaviour_events_protocol_reviewed_by_fkey(first_name, last_name), photo:behaviour_photos(status)')
        .not('protocol_reviewed_at', 'is', null)
        .order('protocol_reviewed_at', { ascending: false })
        .limit(30),
    ]);

    const pendingPhotos = photos || [];
    let photoEvents = [];
    if (pendingPhotos.length > 0) {
      const { data: evs } = await supabase
        .from('behaviour_events')
        .select(EVENT_FIELDS)
        .in('photo_id', pendingPhotos.map((ph) => ph.photo_id))
        .is('voided_at', null)
        .order('student_id');
      photoEvents = evs || [];
    }

    const photoItems = pendingPhotos.map((photo) => ({
      key: `photo-${photo.photo_id}`,
      photo,
      events: photoEvents.filter((e) => e.photo_id === photo.photo_id),
    }));
    // A -5 event whose picture is still waiting is already on that picture's card.
    const seriousItems = (serious || [])
      .filter((ev) => ev.photo?.status !== 'pending')
      .map(({ photo, ...ev }) => ({ key: `event-${ev.event_id}`, photo: photo || null, events: [ev] }));

    setStudents(s || []);
    // A card with a picture is SMT's; one without is the office's.
    setItems([...photoItems, ...seriousItems].filter((it) => (it.photo ? reviewsPictures : reviewsText)));
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

  async function decide(item, sendText, sendPicture, message) {
    if (sendText && !confirmed[item.key]) {
      setStatus('Tick the protocol confirmation before sending the text to parents.');
      return;
    }
    setBusyKey(item.key);
    setStatus(null);
    // A picture whose events were all withdrawn has no event to send with it.
    const { error } = item.events.length === 0
      ? await supabase.rpc('review_behaviour_photo', { p_photo_id: item.photo.photo_id, p_approve: sendPicture })
      : await supabase.rpc('review_behaviour_for_parents', {
        p_event_ids: item.events.map((e) => e.event_id),
        p_send_text: sendText,
        p_send_picture: sendPicture,
        p_protocol_confirmed: !!confirmed[item.key],
      });
    setBusyKey(null);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(message);
      setConfirmed((c) => ({ ...c, [item.key]: false }));
      load();
    }
  }

  function renderItem(item) {
    const { events, photo } = item;
    const first = events[0];
    const busy = busyKey === item.key;
    // Negative events are hidden until sent; positive ones are always shown.
    const textWaiting = events.some((e) => e.type === 'negative' && !e.visible_to_parents);
    const reviewedBefore = events.every((e) => e.protocol_reviewed_at);
    const photoWaiting = photo?.status === 'pending';
    const flagged = events.some((e) => mentionsAnotherStudent(e.description, e.student_id));
    const names = events.map((e) => fullName(e.students));
    const loggers = [...new Set(events.map((e) => fullName(e.staff)))];

    const updateEvent = (eventId, changes) => {
      setItems((list) => list.map((it) => (it.key === item.key
        ? { ...it, events: it.events.map((x) => (x.event_id === eventId ? { ...x, ...changes } : x)) }
        : it)));
      // The confirmation was for the old wording.
      setConfirmed((c) => ({ ...c, [item.key]: false }));
    };

    return (
      <div key={item.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <strong>
            {names.length === 0 ? 'Not attached to any event (it may have been withdrawn on appeal)'
              : names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`}
          </strong>
          {first && (
            <span>{formatUKDate(first.event_date)} · {first.category ?? '—'} · {first.points > 0 ? '+' : ''}{first.points} points</span>
          )}
        </div>
        {first && (
          <span style={{ fontSize: '0.85em', color: '#666', marginTop: '-0.5rem' }}>
            Logged by {loggers.join(', ')}
            {photo?.uploader && ` · picture added by ${fullName(photo.uploader)}`}
          </span>
        )}

        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {first && (
            <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <strong>Text</strong>
              {events.length <= MAX_EDITORS ? events.map((ev) => (
                <div key={ev.event_id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {events.length > 1 && <span style={{ fontSize: '0.85em', color: '#666' }}>{fullName(ev.students)}</span>}
                  {/* The picture is shown alongside, so the editor doesn't show it again. */}
                  <EventCommentEditor event={{ ...ev, photo_id: null }} onSaved={(changes) => updateEvent(ev.event_id, changes)} />
                </div>
              )) : (
                <span style={{ whiteSpace: 'pre-wrap', color: first.description ? 'inherit' : '#666' }}>
                  {first.description || 'No comment.'}
                  <span style={{ display: 'block', fontSize: '0.85em', color: '#666' }}>
                    Comment on the first of {events.length} events. Edit individual ones from the student&apos;s behaviour page.
                  </span>
                </span>
              )}
              {!textWaiting && (
                <span style={{ fontSize: '0.85em', color: '#666' }}>Parents can already see this text.</span>
              )}
              {flagged && (
                <p style={{ color: '#b45309', fontWeight: 'bold', margin: 0 }}>
                  ⚠ This text may name another enrolled student. Edit it before sending.
                </p>
              )}
            </div>
          )}
          {photo && (
            <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-start' }}>
              <strong>Picture</strong>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${photo.image_jpeg_base64}`}
                alt="Picture added with this behaviour event"
                style={{ width: 'min(100%, 360px)', borderRadius: 8, border: '1px solid var(--slate-200)' }}
              />
              <span style={{ fontSize: '0.85em', color: '#666' }}>
                {photoWaiting && 'Check it shows only what it should and no other student can be identified.'}
                {photo.status === 'approved' && 'Approved earlier.'}
                {photo.status === 'rejected' && 'Not sent earlier.'}
              </span>
            </div>
          )}
        </div>

        {textWaiting && (
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={!!confirmed[item.key]}
              onChange={(e) => setConfirmed({ ...confirmed, [item.key]: e.target.checked })}
              style={{ flex: '0 0 auto', width: 'auto' }}
            />
            I confirm the text follows school behaviour protocol, names no other student, and is written in good English.
          </label>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {textWaiting && photo && (
            <>
              <button disabled={busy || !confirmed[item.key]} onClick={() => decide(item, true, true, 'Text and picture sent to parents.')} style={{ width: 'fit-content' }}>
                Send text with picture
              </button>
              <button disabled={busy || !confirmed[item.key]} onClick={() => decide(item, true, false, 'Text sent to parents, without the picture.')} style={{ width: 'fit-content' }}>
                Send text without picture
              </button>
            </>
          )}
          {textWaiting && !photo && (
            <button disabled={busy || !confirmed[item.key]} onClick={() => decide(item, true, null, 'Text sent to parents.')} style={{ width: 'fit-content' }}>
              Send text
            </button>
          )}
          {textWaiting && !reviewedBefore && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => decide(
                item, false, photoWaiting ? false : null,
                first.points <= seriousPoints
                  ? 'Not sent. It stays under "Kept hidden" below until it\'s sent.'
                  : 'Not sent to parents.',
              )}
              style={{ width: 'fit-content' }}
            >
              {photo ? "Don't send text or picture" : "Don't send yet"}
            </button>
          )}
          {!textWaiting && photoWaiting && (
            <>
              <button disabled={busy} onClick={() => decide(item, null, true, 'Picture sent to parents.')} style={{ width: 'fit-content' }}>
                Send picture
              </button>
              <button className="secondary" disabled={busy} onClick={() => decide(item, null, false, 'Picture not sent.')} style={{ width: 'fit-content' }}>
                Don&apos;t send picture
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!canReview) {
    return <p>This page is for SMT, school office staff and admin only.</p>;
  }

  const waiting = items.filter((it) => !it.events.length || !it.events.every((e) => e.protocol_reviewed_at) || it.photo?.status === 'pending');
  const keptHidden = items.filter((it) => !waiting.includes(it));

  return (
    <div>
      <h1>Behaviour Review</h1>
      <p style={{ color: '#555' }}>
        {reviewsPictures && reviewsText && `SMT review every event with a picture; the school office reviews ${seriousPoints} events without one. `}
        {reviewsPictures && !reviewsText && 'Events with a picture are reviewed by SMT. '}
        {reviewsText && !reviewsPictures && `You review ${seriousPoints} events without a picture. SMT review any event with a picture. `}
        Check each event before parents see it. The text and the picture are
        separate. You can send the text with the picture, send the text without
        it, or use Edit to correct the text first and then send it. Before
        sending text, check it follows school protocol, names no other student
        and is written in clear, good English. Check a picture shows only what
        it should and no other student can be identified.
      </p>

      {status && <p>{status}</p>}

      {loading ? <p>Loading…</p> : (
        <>
          <h2>Waiting for review ({waiting.length})</h2>
          {waiting.length === 0 ? <p>Nothing waiting.</p> : waiting.map(renderItem)}

          {keptHidden.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Kept hidden ({keptHidden.length})</h2>
              <p style={{ color: '#555', marginTop: 0 }}>
                {seriousPoints} events reviewed but not yet sent to parents. Correct the text, then send it.
              </p>
              {keptHidden.map(renderItem)}
            </>
          )}

          <h2 style={{ marginTop: '1.5rem' }}>Recently reviewed</h2>
          {history.length === 0 ? <p>None yet.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Reviewed by</th><th>Text sent</th><th>Picture</th></tr></thead>
              <tbody>
                {history.map((ev) => (
                  <tr key={ev.event_id}>
                    <td>{formatUKDate(ev.event_date)}</td>
                    <td>{fullName(ev.students)}</td>
                    <td>{ev.category ?? '—'}</td>
                    <td>{ev.points}</td>
                    <td>{ev.reviewer ? fullName(ev.reviewer) : '—'}</td>
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
