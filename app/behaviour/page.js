'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function BehaviourPageInner() {
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    student_id: '', event_date: '', type: 'positive', category: '', points: '', description: '',
  });
  const [status, setStatus] = useState(null);

  async function loadEvents() {
    const { data } = await supabase
      .from('behaviour_events')
      .select('event_id, event_date, type, category, points, description, students(first_name,last_name)')
      .order('event_date', { ascending: false })
      .limit(20);
    setEvents(data || []);
  }

  useEffect(() => {
    async function loadOptions() {
      const { data: s } = await supabase.from('students').select('student_id, first_name, last_name').order('last_name');
      setStudents(s || []);
      const { data: c } = await supabase.from('behaviour_categories').select('category_id, name, type, default_points').order('name');
      setCategories(c || []);
    }
    loadOptions();
    loadEvents();
  }, []);

  const categoriesForType = categories.filter((c) => c.type === form.type);

  function handleTypeChange(newType) {
    setForm({ ...form, type: newType, category: '', points: '' });
  }

  function handleCategoryChange(categoryName) {
    const match = categoriesForType.find((c) => c.name === categoryName);
    setForm({ ...form, category: categoryName, points: match?.default_points ?? form.points });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('Saving...');
    const { error } = await supabase.from('behaviour_events').insert([{
      student_id: form.student_id,
      event_date: form.event_date,
      type: form.type,
      category: form.category || null,
      points: form.points || null,
      description: form.description || null,
    }]);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus('Saved.');
      setForm({ student_id: '', event_date: '', type: 'positive', category: '', points: '', description: '' });
      loadEvents();
    }
  }

  return (
    <div>
      <h1>Behaviour Events</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Student
          <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })} required>
            <option value="">Select...</option>
            {students.map((s) => (
              <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
            ))}
          </select>
        </label>

        <label>
          Date
          <input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} required />
        </label>

        <label>
          Type
          <select value={form.type} onChange={(e) => handleTypeChange(e.target.value)}>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
        </label>

        <label>
          Category
          <select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)}>
            <option value="">Select...</option>
            {categoriesForType.map((c) => (
              <option key={c.category_id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label>
          Points
          <input type="number" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
        </label>

        <label>
          Description
          <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>

        <button type="submit">Add event</button>
      </form>

      {status && <p>{status}</p>}

      <h2>Recent events</h2>
      <div className="table-scroll"><table>
        <thead>
          <tr><th>Date</th><th>Student</th><th>Type</th><th>Category</th><th>Points</th></tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.event_id}>
              <td>{ev.event_date}</td>
              <td>{ev.students?.first_name} {ev.students?.last_name}</td>
              <td>{ev.type}</td>
              <td>{ev.category ?? '—'}</td>
              <td>{ev.points ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function BehaviourPage() {
  return <RequireAuth><BehaviourPageInner /></RequireAuth>;
}
