'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatUKDate } from '../../lib/formatDate';
import { useBehaviourRules } from '../../lib/behaviourRules';
import { GuidanceText, SeriousConfirmTick } from './SeriousEventGuidance';

// Behaviour Review's "All events" tab (migration 376): every behaviour event
// over a range of dates, with its category and comment, for the reviewers to
// look through. A reviewer can change an event's category (within its type)
// and must say why; recategorise_behaviour_event() makes the change as any
// edit would (points from the category, detentions to match), keeps it in
// behaviour_category_changes and sends the note to the teacher's inbox.
// A reviewer can also cancel a wrongly logged event (migration 377,
// cancel_behaviour_event()): it stays on the record crossed out, its points
// stop counting, a detention not yet held is cancelled, and the teacher gets
// the reason. Cancelled events are listed only when asked for.

const MAX_ROWS = 2000;

function fullName(p) {
  return p ? `${p.first_name} ${p.last_name}` : '—';
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

function signed(points) {
  return points > 0 ? `+${points}` : `${points}`;
}

function outcome(data, teacher) {
  const parts = ['Category changed.'];
  const day = data?.detention_date ? formatUKDate(data.detention_date, { weekday: true }) : null;
  if (data?.detentions_added) parts.push(`Detention added for ${day}.`);
  if (data?.detentions_cancelled) parts.push(`Detention for ${day} cancelled — the student has been told.`);
  if (data?.own_event) parts.push('You logged this event, so no message was sent.');
  else if (data?.notified) parts.push(`${teacher} has your note in their inbox.`);
  else parts.push(`${teacher} has no Formwork login to send the note to, so please tell them.`);
  return parts.join(' ');
}

export default function BehaviourBrowser() {
  const { serious_event_points: seriousPoints, serious_event_guidance: seriousGuidance } = useBehaviourRules();
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [events, setEvents] = useState([]);
  const [changes, setChanges] = useState({}); // event_id -> [change, ...] newest first
  const [cancellations, setCancellations] = useState({}); // event_id -> cancellation
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The row being changed: { eventId, mode: 'category' | 'cancel', category, note, confirmed }
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState({}); // event_id -> outcome text
  const [notice, setNotice] = useState(null); // shown above the list (a cancelled row may leave it)

  useEffect(() => {
    supabase.from('behaviour_categories').select('name, type, default_points, description, retired').order('name')
      .then(({ data }) => setCategories(data || []));
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    let q = supabase
      .from('behaviour_events')
      .select('event_id, event_date, event_time, type, category, points, voided_points, voided_at, description, staff_id, visible_to_parents, returned_at, students!behaviour_events_student_id_fkey(first_name, last_name, year_group), staff!behaviour_events_staff_id_fkey(first_name, last_name)')
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date', { ascending: false })
      .order('event_id', { ascending: false })
      .limit(MAX_ROWS);
    if (type) q = q.eq('type', type);
    if (category) q = q.eq('category', category);
    if (!showCancelled) q = q.is('voided_at', null);
    const [{ data, error: err }, { data: ch }, { data: cx }] = await Promise.all([
      q,
      supabase
        .from('behaviour_category_changes')
        .select('event_id, changed_at, old_category, old_points, new_category, new_points, note, changer:staff!behaviour_category_changes_changed_by_fkey(first_name, last_name)')
        .order('changed_at', { ascending: false })
        .limit(1000),
      supabase
        .from('behaviour_event_cancellations')
        .select('event_id, cancelled_at, note, canceller:staff!behaviour_event_cancellations_cancelled_by_fkey(first_name, last_name)')
        .order('cancelled_at', { ascending: false })
        .limit(1000),
    ]);
    if (err) setError(err.message);
    setEvents(data || []);
    const byEvent = {};
    (ch || []).forEach((c) => { (byEvent[c.event_id] ||= []).push(c); });
    setChanges(byEvent);
    const cancelled = {};
    (cx || []).forEach((c) => { cancelled[c.event_id] ||= c; });
    setCancellations(cancelled);
    setLoading(false);
  }

  useEffect(() => { load(); }, [from, to, type, category, showCancelled]);

  const years = useMemo(
    () => [...new Set(events.map((e) => e.students?.year_group).filter((y) => y != null))].sort((a, b) => a - b),
    [events],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((e) => {
      if (year && String(e.students?.year_group) !== year) return false;
      if (!term) return true;
      return [fullName(e.students), fullName(e.staff), e.description, e.category]
        .some((s) => (s || '').toLowerCase().includes(term));
    });
  }, [events, year, search]);

  const categoryOptions = categories.filter((c) => !type || c.type === type);

  async function save(ev) {
    const chosen = categories.find((c) => c.name === editing.category && c.type === ev.type);
    if (!chosen) { setMessages({ ...messages, [ev.event_id]: 'Choose the new category.' }); return; }
    if (!editing.note.trim()) { setMessages({ ...messages, [ev.event_id]: 'Say why, so the teacher knows.' }); return; }
    const becomingSerious = ev.type === 'negative' && chosen.default_points <= seriousPoints && ev.points > seriousPoints;
    if (becomingSerious && !editing.confirmed) {
      setMessages({ ...messages, [ev.event_id]: 'Read the Stage 5 guidance and tick the confirmation first.' });
      return;
    }
    setSaving(true);
    const { data, error: err } = await supabase.rpc('recategorise_behaviour_event', {
      p_event_id: ev.event_id,
      p_category: chosen.name,
      p_note: editing.note,
    });
    setSaving(false);
    if (err) { setMessages({ ...messages, [ev.event_id]: `Couldn't change it: ${err.message}` }); return; }
    setMessages({ ...messages, [ev.event_id]: outcome(data, fullName(ev.staff)) });
    setEditing(null);
    load();
  }

  async function cancelEvent(ev) {
    if (!editing.note.trim()) { setMessages({ ...messages, [ev.event_id]: 'Say why, so the teacher knows.' }); return; }
    setSaving(true);
    const { data, error: err } = await supabase.rpc('cancel_behaviour_event', { p_event_id: ev.event_id, p_note: editing.note });
    setSaving(false);
    if (err) { setMessages({ ...messages, [ev.event_id]: `Couldn't cancel it: ${err.message}` }); return; }
    const parts = ['Event cancelled: its points no longer count.'];
    if (data?.detentions_cancelled) parts.push('Its detention has been cancelled — the student has been told.');
    if (data?.own_event) parts.push('You logged this event, so no message was sent.');
    else if (data?.notified) parts.push(`${fullName(ev.staff)} has your note in their inbox.`);
    else parts.push(`${fullName(ev.staff)} has no Formwork login to send the note to, so please tell them.`);
    setNotice(`${fullName(ev.students)}, ${ev.category ?? ev.type} on ${formatUKDate(ev.event_date)}: ${parts.join(' ')}`);
    setEditing(null);
    load();
  }

  function renderCancel(ev) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem' }}>
          Cancel this event? It stays on the student&apos;s record crossed out, its points stop counting
          {ev.type === 'negative' && ' and a detention not yet held is cancelled'}. This can&apos;t be undone here.
        </span>
        <textarea
          rows={2}
          value={editing.note}
          onChange={(e) => setEditing({ ...editing, note: e.target.value })}
          placeholder={`Why? e.g. Logged against the wrong student. ${fullName(ev.staff)} gets this note in their inbox.`}
          style={{ font: 'inherit', width: '100%' }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || !editing.note.trim()} onClick={() => cancelEvent(ev)} style={{ width: 'fit-content', background: 'var(--red-700, #b91c1c)', borderColor: 'var(--red-700, #b91c1c)' }}>
            {saving ? 'Cancelling…' : 'Cancel event and tell the teacher'}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(null)} style={{ width: 'fit-content' }}>
            Keep it
          </button>
        </div>
      </div>
    );
  }

  function renderEditor(ev) {
    const options = categories.filter((c) => c.type === ev.type && c.name !== ev.category && !c.retired);
    const chosen = options.find((c) => c.name === editing.category);
    const becomingSerious = chosen && ev.type === 'negative' && chosen.default_points <= seriousPoints && ev.points > seriousPoints;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={editing.category}
            onChange={(e) => setEditing({ ...editing, category: e.target.value, confirmed: false })}
            style={{ width: 'auto', minWidth: '12rem', flex: '1 1 12rem' }}
          >
            <option value="">New category…</option>
            {options.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({signed(c.default_points)})</option>
            ))}
          </select>
          {chosen && chosen.default_points !== ev.points && (
            <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
              {signed(ev.points)} → {signed(chosen.default_points)} pts
              {ev.type === 'negative' && '; detentions will be updated to match.'}
            </span>
          )}
        </div>
        {chosen?.description && (
          <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{chosen.description}</span>
        )}
        {becomingSerious && (
          <div className="bl-serious">
            <strong>Is this really a Stage 5?</strong> It gives a detention, and is reviewed and then sent to parents.
            {!ev.description && ' It needs an explanation first: use Edit on the event to add one.'}
            <GuidanceText text={seriousGuidance} />
          </div>
        )}
        <textarea
          rows={2}
          value={editing.note}
          onChange={(e) => setEditing({ ...editing, note: e.target.value })}
          placeholder={`Why? ${fullName(ev.staff)} gets this note in their inbox.`}
          style={{ font: 'inherit', width: '100%' }}
        />
        {becomingSerious && (
          <SeriousConfirmTick checked={editing.confirmed} onChange={(v) => setEditing({ ...editing, confirmed: v })} />
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving || !chosen || !editing.note.trim()} onClick={() => save(ev)} style={{ width: 'fit-content' }}>
            {saving ? 'Saving…' : 'Change and tell the teacher'}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(null)} style={{ width: 'fit-content' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#555', marginTop: 0 }}>
        Every behaviour event, with its category and comment. If an event is under the wrong category, use
        <em> Change category</em> and say why: the points and any detention follow the new category. If it
        shouldn&apos;t have been logged at all, use <em>Cancel event</em>: it stays on the record crossed out
        and stops counting. Either way the teacher who logged it gets your note in their inbox.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <label style={{ flex: '0 1 10rem' }}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ flex: '0 1 10rem' }}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label style={{ flex: '0 1 9rem' }}>Type
          <select value={type} onChange={(e) => { setType(e.target.value); setCategory(''); }}>
            <option value="">All</option>
            <option value="negative">Negative</option>
            <option value="positive">Positive</option>
          </select>
        </label>
        <label style={{ flex: '0 1 14rem' }}>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categoryOptions.map((c) => (
              <option key={`${c.type}-${c.name}`} value={c.name}>{c.name} ({signed(c.default_points)}){c.retired ? ' (retired)' : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: '0 1 7rem' }}>Year
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
          </select>
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} style={{ width: 'auto' }} />
          Show cancelled
        </label>
        <label style={{ flex: '1 1 14rem' }}>Search
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student, teacher or words in the comment" />
        </label>
      </div>

      {error && <p style={{ color: 'var(--red-700)' }}>Error: {error}</p>}
      {notice && <p><strong>{notice}</strong></p>}
      {loading ? <p>Loading…</p> : (
        <>
          <p style={{ color: '#555' }}>
            {shown.length} event{shown.length === 1 ? '' : 's'}
            {events.length >= MAX_ROWS && ` (only the latest ${MAX_ROWS} in these dates are loaded; narrow the dates or category to see the rest)`}.
          </p>
          {shown.length > 0 && (
            <div className="table-scroll"><table>
              <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Logged by</th><th>Comment</th></tr></thead>
              <tbody>
                {shown.map((ev) => {
                  const history = changes[ev.event_id] || [];
                  const isEditing = editing?.eventId === ev.event_id;
                  const cancelled = !!ev.voided_at;
                  const cancellation = cancellations[ev.event_id];
                  const strike = (v) => (cancelled ? <s>{v}</s> : v);
                  return (
                    <tr key={ev.event_id} style={cancelled ? { color: 'var(--ink-soft)' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(ev.event_date)}</td>
                      <td>{fullName(ev.students)}{ev.students?.year_group != null && <span style={{ color: '#666' }}> · Y{ev.students.year_group}</span>}</td>
                      <td>
                        {strike(ev.category ?? '—')}
                        {!isEditing && !cancelled && (
                          <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setEditing({ eventId: ev.event_id, mode: 'category', category: '', note: '', confirmed: false })}
                              style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem', width: 'fit-content' }}
                            >
                              Change category
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setEditing({ eventId: ev.event_id, mode: 'cancel', note: '' })}
                              style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem', width: 'fit-content' }}
                            >
                              Cancel event
                            </button>
                          </span>
                        )}
                      </td>
                      <td>{strike(signed(cancelled ? (ev.voided_points ?? ev.points) : ev.points))}</td>
                      <td>{fullName(ev.staff)}</td>
                      <td style={{ minWidth: '16rem' }}>
                        <span style={{ whiteSpace: 'pre-wrap', color: ev.description ? 'inherit' : '#666' }}>{strike(ev.description || 'No comment.')}</span>
                        {cancelled && (
                          <span style={{ display: 'block', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            <strong>{cancellation ? 'Cancelled' : 'Withdrawn on appeal'}</strong>
                            {cancellation && ` by ${fullName(cancellation.canceller)}`} on {formatUKDate(ev.voided_at.slice(0, 10))}
                            {cancellation && `: ${cancellation.note}`}
                          </span>
                        )}
                        {ev.returned_at && <span style={{ display: 'block', fontSize: '0.8rem', color: '#b45309' }}>Returned to the teacher.</span>}
                        {history.map((c) => (
                          <span key={c.changed_at} style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>
                            Changed from {c.old_category ?? '—'} ({signed(c.old_points)}) by {fullName(c.changer)} on {formatUKDate(c.changed_at.slice(0, 10))}: {c.note}
                          </span>
                        ))}
                        {messages[ev.event_id] && (
                          <span style={{ display: 'block', fontSize: '0.85rem', marginTop: '0.25rem' }}>{messages[ev.event_id]}</span>
                        )}
                        {isEditing && (editing.mode === 'cancel' ? renderCancel(ev) : renderEditor(ev))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  );
}
