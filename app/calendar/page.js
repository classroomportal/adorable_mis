'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';

const CATEGORY_LABELS = {
  term_boundary: 'Term boundary',
  relp: 'ReLP (test)',
  exam: 'Exam',
  consult_day: 'Consult day',
  awareness_day: 'Awareness day',
  holiday: 'Holiday',
  other: 'Other',
};

function CalendarInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [terms, setTerms] = useState([]);
  const [events, setEvents] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [newEvent, setNewEvent] = useState({ event_date: '', event_name: '', category: 'relp', year_group_note: '' });
  const [status, setStatus] = useState(null);

  async function loadEvents() {
    const { data: e } = await supabase.from('calendar_events').select('*').order('event_date');
    setEvents(e || []);
  }

  useEffect(() => {
    async function load() {
      const { data: t } = await supabase.from('terms').select('*').order('start_date');
      setTerms(t || []);
      loadEvents();
    }
    load();
  }, []);

  function startEdit(ev) {
    setEditingId(ev.event_id);
    setEditDraft({ ...ev });
  }

  async function saveEdit() {
    const { error } = await supabase.from('calendar_events').update({
      event_date: editDraft.event_date,
      event_name: editDraft.event_name,
      category: editDraft.category,
      year_group_note: editDraft.year_group_note || null,
    }).eq('event_id', editingId);
    if (error) setStatus(`Error: ${error.message}`);
    else { setEditingId(null); setStatus('Saved.'); loadEvents(); }
  }

  async function deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    const { error } = await supabase.from('calendar_events').delete().eq('event_id', id);
    if (error) setStatus(`Error: ${error.message}`);
    else { setStatus('Deleted.'); loadEvents(); }
  }

  async function addEvent(e) {
    e.preventDefault();
    if (!newEvent.event_date || !newEvent.event_name) { setStatus('Date and name are required.'); return; }
    const { error } = await supabase.from('calendar_events').insert([{
      event_date: newEvent.event_date,
      event_name: newEvent.event_name,
      category: newEvent.category,
      year_group_note: newEvent.year_group_note || null,
    }]);
    if (error) setStatus(`Error: ${error.message}`);
    else { setNewEvent({ event_date: '', event_name: '', category: 'relp', year_group_note: '' }); setStatus('Added.'); loadEvents(); }
  }

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

      {isAdmin && (
        <div className="card">
          <h2>Add event</h2>
          <form onSubmit={addEvent}>
            <label>Date
              <input type="date" value={newEvent.event_date} onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })} required />
            </label>
            <label>Name
              <input value={newEvent.event_name} onChange={(e) => setNewEvent({ ...newEvent, event_name: e.target.value })} required />
            </label>
            <label>Category
              <select value={newEvent.category} onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value })}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Note (optional)
              <input value={newEvent.year_group_note} onChange={(e) => setNewEvent({ ...newEvent, year_group_note: e.target.value })} placeholder="e.g. Y9/11" />
            </label>
            <button type="submit">Add event</button>
          </form>
        </div>
      )}

      {status && <p>{status}</p>}

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
            <thead><tr><th>Date</th><th>Event</th><th>Category</th><th>Note</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>
              {filtered.map((e) => (
                editingId === e.event_id ? (
                  <tr key={e.event_id}>
                    <td><input type="date" value={editDraft.event_date} onChange={(ev) => setEditDraft({ ...editDraft, event_date: ev.target.value })} /></td>
                    <td><input value={editDraft.event_name} onChange={(ev) => setEditDraft({ ...editDraft, event_name: ev.target.value })} /></td>
                    <td>
                      <select value={editDraft.category} onChange={(ev) => setEditDraft({ ...editDraft, category: ev.target.value })}>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td><input value={editDraft.year_group_note || ''} onChange={(ev) => setEditDraft({ ...editDraft, year_group_note: ev.target.value })} /></td>
                    <td>
                      <button onClick={saveEdit}>Save</button>{' '}
                      <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.event_id}>
                    <td>{e.event_date}</td>
                    <td>{e.event_name}</td>
                    <td>{CATEGORY_LABELS[e.category] || e.category}</td>
                    <td>{e.year_group_note || ''}</td>
                    {isAdmin && (
                      <td>
                        <button className="secondary" onClick={() => startEdit(e)}>Edit</button>{' '}
                        <button className="secondary" onClick={() => deleteEvent(e.event_id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                )
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
