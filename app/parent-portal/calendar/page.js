'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday } from '../../../lib/schoolTime';
import { CALENDAR_CATEGORY_LABELS, downloadIcs, googleCalendarUrl } from '../../../lib/calendarExport';

// Read-only Academic Calendar for parents. The staff page (/calendar) is
// gated to staff roles and is where SMT edit events; writes are SMT-only in
// the database anyway (migrations 205/206), so this page only ever reads.
//
// Teacher Assessment weeks and report-writing periods are staff deadlines,
// not dates for families, so they are left out here. RLS still lets any
// signed-in user read them — they aren't sensitive, just not useful to a
// parent.
const STAFF_ONLY_CATEGORIES = new Set(['teacher_assessment', 'report_period']);

const labelFor = (category) => CALENDAR_CATEGORY_LABELS[category] || '';

function ParentCalendarInner() {
  const [terms, setTerms] = useState([]);
  const [events, setEvents] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const today = schoolToday();

  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date, end_date').order('start_date')
      .then(({ data }) => setTerms(data || []));
    supabase.from('calendar_events').select('event_id, event_date, event_name, category, year_group_note').order('event_date')
      .then(({ data }) => setEvents((data || []).filter((e) => !STAFF_ONLY_CATEGORIES.has(e.category))));
  }, []);

  const upcoming = (events || []).filter((e) => e.event_date >= today);
  const shown = showPast ? events || [] : upcoming;
  const currentTerms = terms.filter((t) => t.end_date >= today);

  return (
    <div>
      <p><a href="/">← Back</a></p>
      <h1>School Calendar</h1>

      <div className="card">
        <h2>Term dates</h2>
        {currentTerms.length === 0 ? (
          <p>No term dates published yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Term</th><th>Starts</th><th>Ends</th></tr></thead>
              <tbody>
                {currentTerms.map((t) => (
                  <tr key={t.term_id}>
                    <td>{t.term_name}</td>
                    <td>{formatUKDate(t.start_date, { weekday: true })}</td>
                    <td>{formatUKDate(t.end_date, { weekday: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Events</h2>
        <p style={{ fontSize: '0.9rem' }}>
          Tap <strong>Add</strong> on any event to put it in your own calendar — <em>Apple / Outlook</em> downloads a
          calendar file your phone or computer opens, <em>Google</em> opens Google Calendar.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            disabled={upcoming.length === 0}
            onClick={() => downloadIcs(upcoming, 'abc-school-calendar.ics', labelFor)}
          >
            Add all upcoming events ({upcoming.length})
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            Show past events
          </label>
        </div>

        {events === null ? (
          <p>Loading…</p>
        ) : shown.length === 0 ? (
          <p>No upcoming events.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Add to my calendar</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.event_id} style={e.event_date < today ? { opacity: 0.6 } : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(e.event_date, { weekday: true })}</td>
                    <td>{e.event_name}{e.year_group_note ? ` (${e.year_group_note})` : ''}</td>
                    <td>{labelFor(e.category) || e.category}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => downloadIcs([e], `abc-${e.event_date}.ics`, labelFor)}
                      >
                        Apple / Outlook
                      </button>{' '}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => window.open(googleCalendarUrl(e, labelFor(e.category)), '_blank', 'noopener')}
                      >
                        Google
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ParentCalendarPage() {
  return <RequireAuth><ParentCalendarInner /></RequireAuth>;
}
