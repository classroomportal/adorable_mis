'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import { schoolToday } from '../../lib/schoolTime';
import { formatUKDate } from '../../lib/formatDate';
import EventCommentEditor from '../components/EventCommentEditor';

const STATUS_OPTIONS = ['scheduled', 'attended', 'missed', 'cancelled'];
const STATUS_LABELS = { scheduled: 'Scheduled', attended: 'Attended', missed: 'Missed', cancelled: 'Cancelled' };

// All week arithmetic is done on UTC-midnight dates built from the school's
// own calendar day (schoolToday). Mixing local-midnight Dates with
// toISOString() shifted every date back a day in Lagos (UTC+1), so the page
// asked for Thursday's detentions and never found the Friday rows.
function saturdayOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToSat = (day - 6 + 7) % 7; // days since the most recent Saturday (0 if today is Saturday)
  d.setUTCDate(d.getUTCDate() - diffToSat);
  return d;
}
function fmt(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }

function DetentionInner() {
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = previous, etc.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eventsError, setEventsError] = useState(null);
  const [openComments, setOpenComments] = useState({}); // event_id -> comment shown

  const baseSat = saturdayOf(new Date(`${schoolToday()}T00:00:00Z`));
  const start = addDays(baseSat, weekOffset * 7);
  const end = addDays(start, 6); // Friday — detentions are always dated to this Friday

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('detentions')
      .select('detention_id, student_id, behaviour_event_id, status, students(first_name, last_name, year_group, form_class)')
      .eq('detention_date', fmt(end));

    // A student can be flagged by both a serious single event and the weekly
    // total in the same week — one entry per student, so the status control
    // reads as one detention.
    const grouped = {};
    (data || []).forEach((row) => {
      if (!grouped[row.student_id]) {
        grouped[row.student_id] = {
          student_id: row.student_id,
          student: row.students,
          status: row.status,
          detentionIds: [],
          seriousEventIds: new Set(),
          weeklyTotal: false,
        };
      }
      const g = grouped[row.student_id];
      g.detentionIds.push(row.detention_id);
      if (row.behaviour_event_id) g.seriousEventIds.add(row.behaviour_event_id);
      else g.weeklyTotal = true;
    });

    // The events behind each detention, one line each. A serious event is its
    // own cause; a weekly-total detention (no event of its own) comes from
    // every negative event that Saturday-to-Friday, the same window
    // handle_negative_behaviour() sums.
    const studentIds = Object.keys(grouped).map(Number);
    let events = [];
    if (studentIds.length > 0) {
      // staff!…_staff_id_fkey: behaviour_events links to staff twice (who
      // recorded it, and protocol_reviewed_by), so a bare staff(...) embed is
      // ambiguous and PostgREST rejects the whole query.
      const { data: ev, error: evErr } = await supabase
        .from('behaviour_events')
        .select('event_id, student_id, staff_id, photo_id, event_date, event_time, type, category, points, description, staff!behaviour_events_staff_id_fkey(first_name, last_name)')
        .in('student_id', studentIds)
        .eq('type', 'negative')
        .is('voided_at', null) // appeal upheld (migration 196)
        .gte('event_date', fmt(start))
        .lte('event_date', fmt(end))
        .order('event_date')
        .order('event_time', { nullsFirst: true });
      setEventsError(evErr ? `Couldn't load the events behind these detentions: ${evErr.message}` : null);
      events = ev || [];
    }
    for (const g of Object.values(grouped)) {
      const mine = events.filter((e) => e.student_id === g.student_id);
      g.weekPoints = mine.reduce((n, e) => n + (e.points || 0), 0);
      g.events = mine
        .filter((e) => g.weeklyTotal || g.seriousEventIds.has(e.event_id))
        .map((e) => ({ ...e, serious: g.seriousEventIds.has(e.event_id) }));
    }

    const list = Object.values(grouped).sort((a, b) =>
      (a.student?.last_name || '').localeCompare(b.student?.last_name || '')
    );
    setRows(list);
    setLoading(false);
  }

  useEffect(() => { load(); }, [weekOffset]);

  async function updateStatus(detentionIds, newStatus) {
    const { error: err } = await supabase.from('detentions').update({ status: newStatus }).in('detention_id', detentionIds);
    setError(err ? `Couldn't save that status: ${err.message}` : null);
    load();
  }

  return (
    <div>
      <div className="no-print">
        <h1>Friday Detention List</h1>
        <p>Students flagged by a serious single event or 10+ negative points, Saturday through Friday.</p>
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem' }}>
          <button className="secondary" onClick={() => setWeekOffset((w) => w - 1)}>← Previous week</button>
          <strong>{formatUKDate(fmt(start), { weekday: true })} to {formatUKDate(fmt(end), { weekday: true })}</strong>
          <button className="secondary" onClick={() => setWeekOffset((w) => w + 1)} disabled={weekOffset >= 0}>Next week →</button>
          {weekOffset !== 0 && <button className="secondary" onClick={() => setWeekOffset(0)}>This week</button>}
        </div>
        {error && <p style={{ color: '#a3232c' }}>{error}</p>}
        {eventsError && <p style={{ color: '#a3232c' }}>{eventsError}</p>}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{rows.length} student{rows.length === 1 ? '' : 's'} for detention</h2>
          <button className="no-print" onClick={() => window.print()}>Print list</button>
        </div>
        {loading ? <p>Loading...</p> : rows.length === 0 ? <p>Nobody has reached the threshold this week.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student / event</th><th>Year</th><th>Form</th><th>Status</th></tr></thead>
            {rows.map((r) => (
              <tbody key={r.student_id} style={{ borderTop: '2px solid var(--slate-200)' }}>
                <tr>
                  <td>
                    <strong>{r.student?.first_name} {r.student?.last_name}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
                      {[
                        r.seriousEventIds.size > 0 && `${r.seriousEventIds.size} serious event${r.seriousEventIds.size === 1 ? '' : 's'}`,
                        r.weeklyTotal && `weekly total ${r.weekPoints} pts`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>{r.student?.year_group}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.student?.form_class}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <select
                      className="no-print"
                      value={r.status}
                      onChange={(e) => updateStatus(r.detentionIds, e.target.value)}
                      style={{ width: 'auto', minWidth: '9rem' }}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                    <span className="print-only">{STATUS_LABELS[r.status] || r.status}</span>
                  </td>
                </tr>
                {r.events.map((e) => (
                  <Fragment key={e.event_id}>
                    <tr>
                      <td colSpan={4} style={{ paddingLeft: '1.5rem', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.25rem 0.9rem' }}>
                          <span style={{ whiteSpace: 'nowrap', color: 'var(--ink-soft)', minWidth: '7.5rem' }}>
                            {formatUKDate(e.event_date, { weekday: true }).replace(/ \d{4}$/, '')}{e.event_time ? ` ${e.event_time.slice(0, 5)}` : ''}
                          </span>
                          <span style={{ whiteSpace: 'nowrap' }}>{e.category || 'Negative event'}</span>
                          <strong style={{ whiteSpace: 'nowrap' }}>{e.points} pts</strong>
                          {e.serious && <span className="badge" style={{ background: 'var(--yellow-200)', color: 'var(--ink)' }}>Serious — detention on its own</span>}
                          {e.staff && <span style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{e.staff.first_name} {e.staff.last_name}</span>}
                          {(e.description || e.photo_id) && (
                            <button
                              type="button"
                              className="secondary no-print"
                              onClick={() => setOpenComments((o) => ({ ...o, [e.event_id]: !o[e.event_id] }))}
                              style={{ padding: '0.15rem 0.55rem', fontSize: '0.8rem', marginLeft: 'auto' }}
                            >
                              {openComments[e.event_id] ? 'Hide' : e.description ? `Show staff comment${e.photo_id ? ' 📷' : ''}` : 'Show picture'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {(e.description || e.photo_id) && openComments[e.event_id] && (
                      <tr>
                        <td colSpan={4} style={{ paddingLeft: '1.5rem' }}>
                          <div style={{ fontSize: '0.9rem', background: 'var(--slate-50)', borderLeft: '3px solid var(--brand-600)', padding: '0.5rem 0.75rem', borderRadius: 4 }}>
                            <EventCommentEditor event={e} onSaved={() => load()} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {r.events.length === 0 && (
                  <tr><td colSpan={4} style={{ paddingLeft: '1.5rem', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No events found for this week.</td></tr>
                )}
              </tbody>
            ))}
          </table></div>
        )}
      </div>
    </div>
  );
}

export default function DetentionPage() {
  return <RequireAuth><RequireResource resourceKey="/detention"><DetentionInner /></RequireResource></RequireAuth>;
}
