'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import { schoolToday } from '../../../lib/schoolTime';
import { academicYearOf, loadCurrentAcademicYearLabel } from '../../../lib/academicYear';
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

// The parent's own subscription link (migration 274). Their calendar app
// fetches it every few hours, so changes SMT make to the school calendar
// reach the parent's phone by themselves, unlike the one-off downloads below.
// Only a parent login has one; staff opening this page don't see the card.
function SubscribeCard() {
  const [token, setToken] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.rpc('my_calendar_feed_token').then(({ data, error: err }) => {
      if (err) setError('Your calendar link could not be loaded. Please try again later.');
      else setToken(data);
    });
  }, []);

  async function reset() {
    if (!window.confirm('Make a new link? The old one will stop working, so any calendar already subscribed with it will stop updating until you subscribe again.')) return;
    const { data, error: err } = await supabase.rpc('my_calendar_feed_token', { p_reset: true });
    if (err) { setError('A new link could not be made. Please try again later.'); return; }
    setToken(data);
    setCopied(false);
  }

  const httpsUrl = token ? `${window.location.origin}/api/calendar-feed/${token}.ics` : '';
  const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');

  async function copy() {
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="card">
      <h2>Keep your calendar up to date</h2>
      <p style={{ fontSize: '0.9rem' }}>
        Subscribe once and school events appear in your phone or computer calendar, and stay up to date:
        if a date moves or an event is cancelled, your calendar changes too (it checks every few hours).
      </p>
      {error ? <p style={{ color: '#b00020' }}>{error}</p> : !token ? <p>Loading…</p> : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button type="button" onClick={() => { window.location.href = webcalUrl; }}>
              Subscribe (iPhone, Mac, Outlook)
            </button>
            <button
              type="button"
              onClick={() => window.open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`, '_blank', 'noopener')}
            >
              Subscribe in Google Calendar
            </button>
            <button type="button" className="secondary" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#5b6472', margin: 0 }}>
            This link is yours alone, so please don&apos;t share it. If it has been passed on,{' '}
            <button type="button" className="secondary" onClick={reset} style={{ padding: '0.1rem 0.5rem' }}>make a new link</button>{' '}
            and subscribe again with that one.
          </p>
        </>
      )}
    </div>
  );
}

function ParentCalendarInner() {
  const { profile } = useAuth();
  const [terms, setTerms] = useState([]);
  const [events, setEvents] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [currentYear, setCurrentYear] = useState(null);
  const today = schoolToday();

  useEffect(() => {
    supabase.from('terms').select('term_id, term_name, start_date, end_date').order('start_date')
      .then(({ data }) => setTerms(data || []));
    supabase.from('calendar_events').select('event_id, event_date, event_name, category, year_group_note').order('event_date')
      .then(({ data }) => setEvents((data || []).filter((e) => !STAFF_ONLY_CATEGORIES.has(e.category))));
    loadCurrentAcademicYearLabel().then(setCurrentYear);
  }, []);

  const upcoming = (events || []).filter((e) => e.event_date >= today);
  // "Show past events" means earlier this academic year, not the historic
  // exam result sets that go back to 2017 (migrations 246/252).
  const shown = showPast
    ? (events || []).filter((e) => e.event_date >= today || academicYearOf(e.event_date) === currentYear)
    : upcoming;
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

      {profile?.parent_id && <SubscribeCard />}

      <div className="card">
        <h2>Events</h2>
        <p style={{ fontSize: '0.9rem' }}>
          You can also save single events to your own calendar — <em>Apple / Outlook</em> downloads a
          calendar file your phone or computer opens, <em>Google</em> opens Google Calendar. These are one-off
          copies: they <strong>won&apos;t change</strong> if the school changes the event later
          {profile?.parent_id ? ', so subscribing above is better' : ''}.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            disabled={upcoming.length === 0}
            onClick={() => downloadIcs(upcoming, 'abc-school-calendar.ics', labelFor)}
          >
            Save a copy of all upcoming events ({upcoming.length})
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            Show earlier events this school year
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
