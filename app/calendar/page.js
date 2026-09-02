'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

const CATEGORY_LABELS = {
  term_boundary: 'Term boundary',
  relp: 'ReLP',
  exam: 'Exam',
  consult_day: 'Consult day',
  awareness_day: 'Awareness day',
  holiday: 'Holiday',
  other: 'Other',
};

function CalendarInner() {
  const [terms, setTerms] = useState([]);
  const [events, setEvents] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    async function load() {
      const { data: t } = await supabase.from('terms').select('*').order('start_date');
      setTerms(t || []);
      const { data: e } = await supabase.from('calendar_events').select('*').order('event_date');
      setEvents(e || []);
    }
    load();
  }, []);

  const filtered = categoryFilter ? events.filter((e) => e.category === categoryFilter) : events;

  return (
    <div>
      <h1>Academic Calendar</h1>

      <div className="card">
        <h2>Terms</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Term</th><th>Start</th><th>End</th></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.term_id}><td>{t.term_name}</td><td>{t.start_date}</td><td>{t.end_date}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Events</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </form>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Event</th><th>Category</th><th>Note</th></tr></thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.event_id}>
                  <td>{e.event_date}</td>
                  <td>{e.event_name}</td>
                  <td>{CATEGORY_LABELS[e.category] || e.category}</td>
                  <td>{e.year_group_note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return <RequireAuth><CalendarInner /></RequireAuth>;
}
