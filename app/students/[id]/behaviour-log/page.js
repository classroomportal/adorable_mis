'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import RequireAuth from '../../../RequireAuth';
import { schoolToday } from '../../../../lib/schoolTime';
import { formatUKDate } from '../../../../lib/formatDate';

// A student's behaviour log to print (the principal, 8 Oct 2026): "A behaviour
// log does not need to list all single point events but anything with 2 or
// more negative or positive and the total." Listed: every event worth 2 or
// more points either way, plus exclusions (0 points, migration 401). The
// totals count every event in the dates, single points included. Withdrawn
// events are left out of both. Reads under the normal RLS.

const MIN_POINTS = 2;

function schoolYearStart(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 9 ? y : y - 1}-09-01`;
}

function BehaviourLogInner() {
  const { id } = useParams();
  const today = schoolToday();
  const [from, setFrom] = useState(schoolYearStart(today));
  const [to, setTo] = useState(today);
  const [student, setStudent] = useState(null);
  const [events, setEvents] = useState(null);
  const [systemCats, setSystemCats] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('students').select('first_name, last_name, year_group, form_class, boarding_house').eq('student_id', id).maybeSingle()
      .then(({ data }) => setStudent(data));
    supabase.from('behaviour_categories').select('name, type').eq('system_only', true)
      .then(({ data }) => setSystemCats(data || []));
  }, [id]);

  useEffect(() => {
    if (!from || !to) return;
    setEvents(null);
    supabase.from('behaviour_events')
      .select('event_id, event_date, type, category, points, description, voided_at, staff!behaviour_events_staff_id_fkey(first_name, last_name)')
      .eq('student_id', id)
      .gte('event_date', from)
      .lte('event_date', to)
      .is('voided_at', null)
      .order('event_date')
      .order('event_id')
      .then(({ data, error: e }) => {
        if (e) { setError(e.message); return; }
        setError(null);
        setEvents(data || []);
      });
  }, [id, from, to]);

  const isExclusion = (e) => systemCats.some((c) => c.name === e.category && c.type === e.type);
  const listed = (events || []).filter((e) => Math.abs(e.points || 0) >= MIN_POINTS || isExclusion(e));
  const positive = (events || []).filter((e) => (e.points || 0) > 0).reduce((n, e) => n + e.points, 0);
  const negative = (events || []).filter((e) => (e.points || 0) < 0).reduce((n, e) => n + e.points, 0);
  const notListed = (events || []).length - listed.length;
  const name = student ? `${student.first_name} ${student.last_name}` : '';

  return (
    <div className="behaviour-log-print">
      <div className="no-print card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <a className="secondary" href={`/students/${id}`}>Back to profile</a>
        <label style={{ flex: 'none' }}>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ flex: 'none' }}>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" onClick={() => window.print()} disabled={!events}>Print</button>
      </div>

      <h1 style={{ marginBottom: '0.2rem' }}>Behaviour log: {name}</h1>
      <p style={{ margin: '0 0 0.75rem' }}>
        {student && <>Year {student.year_group}{student.form_class ? `, ${student.form_class}` : ''}{student.boarding_house ? `, ${student.boarding_house}` : ''} · </>}
        {formatUKDate(from)} to {formatUKDate(to)}
      </p>

      {error ? <p style={{ color: '#b42318' }}>{error}</p> : !events ? <p>Loading...</p> : (
        <>
          <table style={{ width: 'auto', marginBottom: '1rem' }}>
            <tbody>
              <tr><th style={{ textAlign: 'left' }}>Positive points</th><td>{positive > 0 ? `+${positive}` : 0}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Negative points</th><td>{negative}</td></tr>
              <tr><th style={{ textAlign: 'left' }}>Total</th><td><strong>{positive + negative > 0 ? '+' : ''}{positive + negative}</strong></td></tr>
            </tbody>
          </table>
          <p style={{ fontSize: '0.85em', color: '#555' }}>
            Totals count every event in these dates. Listed below: events worth {MIN_POINTS} or more points either way, and exclusions
            {notListed > 0 ? ` (${notListed} single-point event${notListed === 1 ? '' : 's'} not listed)` : ''}.
          </p>
          {listed.length === 0 ? <p>No events to list.</p> : (
            <table>
              <thead><tr><th>Date</th><th>Category</th><th>Points</th><th>Logged by</th><th>Explanation</th></tr></thead>
              <tbody>
                {listed.map((e) => (
                  <tr key={e.event_id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatUKDate(e.event_date)}</td>
                    <td>{e.category}</td>
                    <td>{e.points > 0 ? `+${e.points}` : e.points}</td>
                    <td>{e.staff ? `${e.staff.first_name} ${e.staff.last_name}` : 'School'}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{e.description || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: '0.8em', color: '#555', marginTop: '1rem' }}>Printed {formatUKDate(today)} from Formwork.</p>
        </>
      )}
    </div>
  );
}

export default function BehaviourLogPrintPage() {
  return <RequireAuth><BehaviourLogInner /></RequireAuth>;
}
