'use client';
import { useEffect, useState } from 'react';
import { loadBehaviourRules, useBehaviourRules } from '../../../lib/behaviourRules';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import EventCommentEditor from '../../components/EventCommentEditor';
import BehaviourBrowser from '../../components/BehaviourBrowser';

// What gets checked here before parents see it (migrations 238-239):
//   - any event with a picture (migration 209): SMT and admin;
//   - a -5 event without a picture: the school office, SMT and admin
//     (migration 336: the principal's PA and SMT review Stage 5). Its text
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
// A serious event that isn't really a Stage 5 can be returned to the teacher
// who logged it, with a note (migration 335, return_behaviour_event_to_teacher()).
// It waits under "Returned to the teacher" until they change it: a new
// category takes it out of the review, a new explanation brings it back here.
// While returned it counts 0 points and its future detention is cancelled,
// and each return is tallied against the teacher (migration 337,
// behaviour_event_returns, SMT and admin only).
// Writing (migration 387, the principal 7 Oct 2026): any event with writing
// waits here before it goes home, the whole event, points included. A merit
// or a Stage 1-4 event with writing is listed under "Writing to approve",
// where many can be ticked and sent (or kept at school) at once; one with a
// picture gets a card like the others. A merit with no writing still goes
// home at once, and a Stage 1-4 event with none still stays at school.
// Changing an event's writing brings it back here, even after it was sent.
// The "All events" tab (migration 376, app/components/BehaviourBrowser.js)
// lists every event so the reviewers can look through comments and
// categories, and change a category with a note to the teacher.
const EVENT_FIELDS = 'event_id, event_date, type, category, points, description, student_id, staff_id, photo_id, visible_to_parents, protocol_reviewed_at, returned_at, return_note, returner:staff!behaviour_events_returned_by_fkey(first_name, last_name), students!behaviour_events_student_id_fkey(first_name, last_name), staff!behaviour_events_staff_id_fkey(first_name, last_name)';

const PICTURE_STATUS = { pending: 'Waiting', approved: 'Sent', rejected: 'Not sent' };

// Beyond this many students on one picture (a whole boarding house), the
// comments are shown once rather than with an editor each.
const MAX_EDITORS = 5;

// Ids per review call when sending many at once.
const BATCH = 200;
// The most "Writing to approve" rows read at once (the database's own cap).
const WRITING_LIMIT = 1000;

const hasWriting = (text) => !!text && text.trim() !== '';

function fullName(p) {
  return p ? `${p.first_name} ${p.last_name}` : '—';
}

function ReviewInner() {
  const { profile, staffRoles } = useAuth();
  const roles = staffRoles || [];
  const isAdmin = profile?.role === 'admin'; // as is_admin() decides it
  const reviewsPictures = isAdmin || roles.includes('smt');
  const reviewsText = isAdmin || roles.includes('school_office') || roles.includes('smt');
  const canReview = reviewsPictures || reviewsText;

  const [students, setStudents] = useState([]);
  // Cards: { key, events: [...], photo: { photo_id, status, image_jpeg_base64, uploader } | null }
  const [items, setItems] = useState([]);
  // Merits and Stage 1-4 events with writing, no picture: one table.
  const [writing, setWriting] = useState([]);
  const [picked, setPicked] = useState({}); // event_id -> true
  const [writingConfirmed, setWritingConfirmed] = useState(false);
  const [history, setHistory] = useState([]);
  const [returnTally, setReturnTally] = useState([]); // [{ name, count, last }]
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState({}); // item key -> boolean
  const [returning, setReturning] = useState({}); // item key -> note being written, when open
  const [busyKey, setBusyKey] = useState(null);
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('review');
  const { serious_event_points: seriousPoints } = useBehaviourRules();

  async function load() {
    setLoading(true);
    const rules = await loadBehaviourRules();
    const [{ data: s }, { data: photos }, { data: serious }, { data: h }, { data: rets }, { data: written }] = await Promise.all([
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
        // A returned event counts 0 points until the teacher regrades it.
        .or(`points.lte.${rules.serious_event_points},returned_at.not.is.null`)
        .eq('visible_to_parents', false)
        .is('voided_at', null)
        .order('event_date', { ascending: false }),
      supabase
        .from('behaviour_events')
        .select('event_id, event_date, category, points, visible_to_parents, protocol_reviewed_at, students!behaviour_events_student_id_fkey(first_name, last_name), reviewer:staff!behaviour_events_protocol_reviewed_by_fkey(first_name, last_name), photo:behaviour_photos(status)')
        .not('protocol_reviewed_at', 'is', null)
        .order('protocol_reviewed_at', { ascending: false })
        .limit(30),
      // Read only by SMT and admins; others get no rows.
      supabase
        .from('behaviour_event_returns')
        .select('returned_at, teacher:staff!behaviour_event_returns_teacher_staff_id_fkey(first_name, last_name)')
        .order('returned_at', { ascending: false }),
      // Writing not yet approved (migration 387): merits and Stage 1-4.
      supabase
        .from('behaviour_events')
        .select(`${EVENT_FIELDS}, photo:behaviour_photos(photo_id, status, image_jpeg_base64)`)
        .eq('visible_to_parents', false)
        .is('protocol_reviewed_at', null)
        .is('voided_at', null)
        .is('returned_at', null)
        .not('description', 'is', null)
        .or(`type.eq.positive,points.gt.${rules.serious_event_points}`)
        .order('event_date', { ascending: false })
        .order('event_id', { ascending: false })
        .limit(WRITING_LIMIT),
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

    const writtenEvents = (written || []).filter((ev) => hasWriting(ev.description));
    // With a picture: a card, unless it's already on its picture's card.
    const writtenPictureItems = writtenEvents
      .filter((ev) => ev.photo_id && ev.photo?.status !== 'pending')
      .map(({ photo, ...ev }) => ({ key: `event-${ev.event_id}`, photo: photo || null, events: [ev] }));

    setStudents(s || []);
    // A card with a picture is SMT's; one without is the office's.
    setItems([...photoItems, ...seriousItems, ...writtenPictureItems].filter((it) => (it.photo ? reviewsPictures : reviewsText)));
    setWriting(reviewsText ? writtenEvents.filter((ev) => !ev.photo_id).map(({ photo, ...ev }) => ev) : []);
    setPicked({});
    setWritingConfirmed(false);
    setHistory(h || []);
    const tally = new Map();
    (rets || []).forEach((r) => {
      const name = fullName(r.teacher);
      const t = tally.get(name) || { name, count: 0, last: r.returned_at };
      t.count += 1;
      tally.set(name, t);
    });
    setReturnTally([...tally.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
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

  async function decideWriting(send) {
    const ids = writing.filter((ev) => picked[ev.event_id]).map((ev) => ev.event_id);
    if (ids.length === 0) {
      setStatus('Tick the events first.');
      return;
    }
    if (send && !writingConfirmed) {
      setStatus('Tick the protocol confirmation before sending to parents.');
      return;
    }
    setBusyKey('writing');
    setStatus(null);
    let done = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const { error } = await supabase.rpc('review_behaviour_for_parents', {
        p_event_ids: ids.slice(i, i + BATCH),
        p_send_text: send,
        p_send_picture: null,
        p_protocol_confirmed: send ? writingConfirmed : false,
      });
      if (error) {
        setBusyKey(null);
        setStatus(`Error after ${done} of ${ids.length}: ${error.message}`);
        load();
        return;
      }
      done += Math.min(BATCH, ids.length - i);
    }
    setBusyKey(null);
    setStatus(send
      ? `${done} event${done === 1 ? '' : 's'} sent to parents.`
      : `${done} event${done === 1 ? '' : 's'} kept at school; parents won't see ${done === 1 ? 'it' : 'them'}.`);
    load();
  }

  async function returnToTeacher(item) {
    const ev = item.events[0];
    const note = (returning[item.key] || '').trim();
    if (!note) {
      setStatus('Say why it is being returned, so the teacher knows what to change.');
      return;
    }
    setBusyKey(item.key);
    setStatus(null);
    const { data, error } = await supabase.rpc('return_behaviour_event_to_teacher', { p_event_id: ev.event_id, p_note: note });
    setBusyKey(null);
    if (error) {
      setStatus(`Error: ${error.message}`);
      return;
    }
    setReturning((r) => { const { [item.key]: _, ...rest } = r; return rest; });
    const cancelled = data?.detentions_cancelled ? ' Its detention has been cancelled.' : '';
    setStatus(data?.notified
      ? `Returned to ${fullName(ev.staff)}: its points no longer count.${cancelled} They have a message in their inbox.`
      : `Returned: its points no longer count.${cancelled} ${fullName(ev.staff)} has no Formwork login to send the message to, so please tell them.`);
    load();
  }

  function renderItem(item) {
    const { events, photo } = item;
    const first = events[0];
    const busy = busyKey === item.key;
    // Negative events and events with writing are hidden until sent; a
    // merit with no writing is shown at once (migration 387).
    // A returned event can't be sent until the teacher has changed it.
    const textHidden = events.some((e) => !e.visible_to_parents);
    const textWaiting = textHidden && !events.some((e) => e.returned_at);
    const reviewedBefore = events.every((e) => e.protocol_reviewed_at);
    const photoWaiting = photo?.status === 'pending';
    const flagged = events.some((e) => mentionsAnotherStudent(e.description, e.student_id));
    const names = events.map((e) => fullName(e.students));
    const loggers = [...new Set(events.map((e) => fullName(e.staff)))];
    // One serious event, not yet with parents or already returned.
    const canReturn = events.length === 1 && textWaiting && first.points <= seriousPoints;

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
        {first?.returned_at && (
          <span className="bl-returned">
            <strong>Returned to the teacher</strong> by {fullName(first.returner)} on {formatUKDate(first.returned_at.slice(0, 10))}: {first.return_note}
            {' '}It counts 0 points until they change it.
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
                  <EventCommentEditor event={{ ...ev, photo_id: null, return_note: null }} onSaved={(changes) => updateEvent(ev.event_id, changes)} />
                </div>
              )) : (
                <span style={{ whiteSpace: 'pre-wrap', color: first.description ? 'inherit' : '#666' }}>
                  {first.description || 'No comment.'}
                  <span style={{ display: 'block', fontSize: '0.85em', color: '#666' }}>
                    Comment on the first of {events.length} events. Edit individual ones from the student&apos;s behaviour page.
                  </span>
                </span>
              )}
              {!textHidden && (
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

        {canReturn && returning[item.key] !== undefined && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            Why isn&apos;t this a Stage 5? The teacher gets this in their inbox.
            <textarea
              rows={2}
              value={returning[item.key]}
              onChange={(e) => setReturning({ ...returning, [item.key]: e.target.value })}
              placeholder="e.g. Talking in class is Disruption in class (-2), not Stage 5."
              style={{ font: 'inherit' }}
              autoFocus
            />
          </label>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canReturn && (returning[item.key] === undefined ? (
            <button className="secondary" disabled={busy} onClick={() => setReturning({ ...returning, [item.key]: '' })} style={{ width: 'fit-content' }}>
              Not Stage 5: return to teacher
            </button>
          ) : (
            <>
              <button disabled={busy} onClick={() => returnToTeacher(item)} style={{ width: 'fit-content' }}>
                Return to {fullName(first.staff)}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setReturning((r) => { const { [item.key]: _, ...rest } = r; return rest; })}
                style={{ width: 'fit-content' }}
              >
                Cancel
              </button>
            </>
          ))}
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

  function renderWriting() {
    const pickedCount = writing.filter((ev) => picked[ev.event_id]).length;
    const allPicked = writing.length > 0 && pickedCount === writing.length;
    const busy = busyKey === 'writing';
    const updateWritten = (eventId, changes) => {
      setWriting((list) => list.map((x) => (x.event_id === eventId ? { ...x, ...changes } : x)));
      setWritingConfirmed(false);
    };
    return (
      <>
        <h2 style={{ marginTop: '1.5rem' }}>
          Writing to approve ({writing.length}{writing.length >= WRITING_LIMIT ? '+' : ''})
        </h2>
        <p style={{ color: '#555', marginTop: 0 }}>
          Merits and Stage 1–4 events with a comment. Parents see none of the event, points included,
          until it&apos;s sent. Read each comment, use Edit to correct one, tick the ones to send, then
          send them together. <em>Keep at school</em> means parents never see it.
          {writing.length >= WRITING_LIMIT && ` Showing the newest ${WRITING_LIMIT}; the rest appear once these are done.`}
        </p>
        {writing.length === 0 ? <p>Nothing waiting.</p> : (
          <>
            <div className="table-scroll"><table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Tick all"
                      checked={allPicked}
                      onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(writing.map((ev) => [ev.event_id, true])) : {})}
                      style={{ width: 'auto' }}
                    />
                  </th>
                  <th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Logged by</th><th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {writing.map((ev) => (
                  <tr key={ev.event_id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Tick ${fullName(ev.students)}`}
                        checked={!!picked[ev.event_id]}
                        onChange={(e) => setPicked((p) => ({ ...p, [ev.event_id]: e.target.checked }))}
                        style={{ width: 'auto' }}
                      />
                    </td>
                    <td>{formatUKDate(ev.event_date)}</td>
                    <td>{fullName(ev.students)}</td>
                    <td>{ev.category ?? '—'}</td>
                    <td>{ev.points > 0 ? '+' : ''}{ev.points}</td>
                    <td>{fullName(ev.staff)}</td>
                    <td style={{ minWidth: '16rem' }}>
                      <EventCommentEditor event={ev} onSaved={(changes) => updateWritten(ev.event_id, changes)} />
                      {mentionsAnotherStudent(ev.description, ev.student_id) && (
                        <span style={{ color: '#b45309', fontWeight: 'bold', fontSize: '0.85em' }}>
                          ⚠ May name another enrolled student. Edit it before sending.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
              <input
                type="checkbox"
                checked={writingConfirmed}
                onChange={(e) => setWritingConfirmed(e.target.checked)}
                style={{ flex: '0 0 auto', width: 'auto' }}
              />
              I confirm the ticked comments follow school behaviour protocol, name no other student, and are written in good English.
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <button disabled={busy || pickedCount === 0 || !writingConfirmed} onClick={() => decideWriting(true)} style={{ width: 'fit-content' }}>
                {busy ? 'Working…' : `Send ${pickedCount} to parents`}
              </button>
              <button className="secondary" disabled={busy || pickedCount === 0} onClick={() => decideWriting(false)} style={{ width: 'fit-content' }}>
                Keep {pickedCount} at school
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  if (!canReview) {
    return <p>This page is for SMT, school office staff and admin only.</p>;
  }

  const isReturned = (it) => it.events.length > 0 && it.events.every((e) => e.returned_at) && it.photo?.status !== 'pending';
  const returned = items.filter(isReturned);
  const waiting = items.filter((it) => !isReturned(it)
    && (!it.events.length || !it.events.every((e) => e.protocol_reviewed_at) || it.photo?.status === 'pending'));
  const keptHidden = items.filter((it) => !isReturned(it) && !waiting.includes(it));

  const tabs = (
    <div className="hr-tabs" role="tablist" style={{ marginBottom: '1rem' }}>
      {[{ key: 'review', label: 'To review' }, { key: 'all', label: 'All events' }].map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          className={`hr-tab ${tab === t.key ? 'is-active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (tab === 'all') {
    return (
      <div>
        <h1>Behaviour Review</h1>
        {tabs}
        <BehaviourBrowser />
      </div>
    );
  }

  return (
    <div>
      <h1>Behaviour Review</h1>
      {tabs}
      <p style={{ color: '#555' }}>
        {reviewsPictures && `You review ${seriousPoints} events, every event with writing, and every event with a picture. `}
        {reviewsText && !reviewsPictures && `You review ${seriousPoints} events and every event with writing, without a picture. SMT review any event with a picture. `}
        Check each event before parents see it. The text and the picture are
        separate. You can send the text with the picture, send the text without
        it, or use Edit to correct the text first and then send it. Before
        sending text, check it follows school protocol, names no other student
        and is written in clear, good English. Check a picture shows only what
        it should and no other student can be identified. If an event isn&apos;t
        really a Stage 5, use <em>Not Stage 5: return to teacher</em> and say
        why; the teacher gets a message asking them to change it.
      </p>

      {status && <p>{status}</p>}

      {loading ? <p>Loading…</p> : (
        <>
          <h2>Waiting for review ({waiting.length})</h2>
          {waiting.length === 0 ? <p>Nothing waiting.</p> : waiting.map(renderItem)}

          {reviewsText && renderWriting()}

          {returned.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Returned to the teacher ({returned.length})</h2>
              <p style={{ color: '#555', marginTop: 0 }}>
                Waiting for the teacher. If they change the category it leaves this page; if they keep it as a
                Stage 5 and edit the explanation, it comes back to Waiting for review.
              </p>
              {returned.map(renderItem)}
            </>
          )}

          {keptHidden.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Kept hidden ({keptHidden.length})</h2>
              <p style={{ color: '#555', marginTop: 0 }}>
                {seriousPoints} events reviewed but not yet sent to parents. Correct the text, then send it.
              </p>
              {keptHidden.map(renderItem)}
            </>
          )}

          {returnTally.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Stage 5s returned, by teacher</h2>
              <p style={{ color: '#555', marginTop: 0 }}>Every return is counted here, even after the teacher has changed the event.</p>
              <div className="table-scroll"><table>
                <thead><tr><th>Teacher</th><th>Returned</th><th>Most recent</th></tr></thead>
                <tbody>
                  {returnTally.map((t) => (
                    <tr key={t.name}><td>{t.name}</td><td>{t.count}</td><td>{formatUKDate(t.last.slice(0, 10))}</td></tr>
                  ))}
                </tbody>
              </table></div>
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
