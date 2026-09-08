'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';

function BehaviourPageInner() {
  const { isPastoralOrSmt, profile } = useAuth();
  const searchParams = useSearchParams();

  const [mentorClasses, setMentorClasses] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const [classId, setClassId] = useState(searchParams.get('classId') || '');
  const [roster, setRoster] = useState([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selected, setSelected] = useState(new Set()); // student_ids chosen from roster
  const [singleStudentId, setSingleStudentId] = useState(''); // used when no class chosen

  const [form, setForm] = useState({
    event_date: searchParams.get('date') || new Date().toISOString().slice(0, 10),
    type: 'positive', category: '', points: '', description: '',
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

  async function loadAlerts() {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const { data } = await supabase
      .from('behaviour_events')
      .select('event_id, event_date, category, points, description, students(first_name,last_name)')
      .eq('type', 'negative')
      .gte('event_date', since.toISOString().slice(0, 10))
      .order('event_date', { ascending: false });
    setAlerts(data || []);
  }

  useEffect(() => {
    async function loadOptions() {
      const { data: c } = await supabase
        .from('classes')
        .select('class_id, class_code, room, subjects(subject_name), curriculum_blocks(block_name)')
        .not('class_code', 'is', null)
        .order('class_code');
      const all = c || [];
      setMentorClasses(all.filter((cl) => cl.curriculum_blocks?.block_name === 'Mentor'));
      setSubjectClasses(all.filter((cl) => cl.curriculum_blocks?.block_name !== 'Mentor'));

      const { data: s } = await supabase.from('students').select('student_id, first_name, last_name').order('last_name');
      setAllStudents(s || []);

      const { data: cat } = await supabase.from('behaviour_categories').select('category_id, name, type, default_points').order('name');
      setCategories(cat || []);
    }
    loadOptions();
    loadEvents();
    loadAlerts();
  }, []);

  async function loadRoster() {
    if (!classId) {
      setRoster([]);
      setSelected(new Set());
      return;
    }
    setLoadingRoster(true);
    const { data: sc } = await supabase
      .from('student_class')
      .select('students(student_id, first_name, last_name)')
      .eq('class_id', classId);
    const studentList = (sc || [])
      .map((row) => row.students)
      .filter(Boolean)
      .sort((a, b) => a.last_name.localeCompare(b.last_name));
    setRoster(studentList);
    setSelected(new Set(studentList.map((s) => s.student_id))); // default: everyone selected
    setLoadingRoster(false);
  }

  useEffect(() => { loadRoster(); }, [classId]);

  const categoriesForType = categories.filter((c) => c.type === form.type);

  function handleTypeChange(newType) {
    setForm({ ...form, type: newType, category: '', points: '' });
  }

  function handleCategoryChange(categoryName) {
    const match = categoriesForType.find((c) => c.name === categoryName);
    setForm({ ...form, category: categoryName, points: match?.default_points ?? form.points });
  }

  function toggleStudent(studentId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(roster.map((s) => s.student_id))); }
  function selectNone() { setSelected(new Set()); }

  async function handleSubmit(e) {
    e.preventDefault();

    const studentIds = classId ? Array.from(selected) : (singleStudentId ? [Number(singleStudentId)] : []);
    if (studentIds.length === 0) {
      setStatus('Choose at least one student.');
      return;
    }

    setStatus('Saving...');
    const rows = studentIds.map((student_id) => ({
      student_id,
      event_date: form.event_date,
      type: form.type,
      category: form.category || null,
      points: form.points || null,
      description: form.description || null,
    }));
    const { error } = await supabase.from('behaviour_events').insert(rows);
    if (error) {
      setStatus(`Error: ${error.message}`);
    } else {
      setStatus(`Saved ${rows.length} event${rows.length > 1 ? 's' : ''}.`);
      setForm({ ...form, category: '', points: '', description: '' });
      if (classId) selectAll(); else setSingleStudentId('');
      loadEvents();
      loadAlerts();
    }
  }

  async function handleDelete(eventId) {
    if (!window.confirm('Delete this behaviour event? This cannot be undone.')) return;
    const { error } = await supabase.from('behaviour_events').delete().eq('event_id', eventId);
    if (error) setStatus(`Error: ${error.message}`);
    else { loadEvents(); loadAlerts(); }
  }

  return (
    <div>
      <h1>Behaviour Events</h1>

      {isPastoralOrSmt && (
        <div className="card">
          <h2>Behaviour Alerts — last 7 days ({alerts.length})</h2>
          {alerts.length === 0 ? <p>No negative events logged in the last 7 days.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Points</th><th>Description</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.event_id}>
                    <td>{a.event_date}</td>
                    <td>{a.students?.first_name} {a.students?.last_name}</td>
                    <td>{a.category ?? '—'}</td>
                    <td>{a.points ?? '—'}</td>
                    <td>{a.description ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          Class / group (optional — pick to log for several students at once)
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">No class — pick one student below</option>
            {mentorClasses.length > 0 && (
              <optgroup label="Mentor groups">
                {mentorClasses.map((c) => (
                  <option key={c.class_id} value={c.class_id}>{c.class_code}</option>
                ))}
              </optgroup>
            )}
            {subjectClasses.length > 0 && (
              <optgroup label="Subject classes">
                {subjectClasses.map((c) => (
                  <option key={c.class_id} value={c.class_id}>
                    {c.class_code} — {c.subjects?.subject_name || ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {classId ? (
          <div style={{ marginTop: '0.75rem' }}>
            {loadingRoster ? <p>Loading roster...</p> : roster.length === 0 ? (
              <p>No students are linked to this class yet.</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button type="button" className="secondary" onClick={selectAll}>Select all</button>
                  <button type="button" className="secondary" onClick={selectNone}>Select none</button>
                  <span style={{ alignSelf: 'center', color: '#666', fontSize: '0.9em' }}>{selected.size} of {roster.length} selected</span>
                </div>
                <div className="table-scroll" style={{ maxHeight: '260px', overflowY: 'auto' }}>
                  {roster.map((s) => (
                    <label key={s.student_id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
                      <input type="checkbox" checked={selected.has(s.student_id)} onChange={() => toggleStudent(s.student_id)} />
                      {s.first_name} {s.last_name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <label style={{ marginTop: '0.75rem' }}>
            Student
            <select value={singleStudentId} onChange={(e) => setSingleStudentId(e.target.value)}>
              <option value="">Select...</option>
              {allStudents.map((s) => (
                <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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

        <button type="submit" style={{ width: 'fit-content' }}>
          {classId ? `Add event for ${selected.size} student${selected.size === 1 ? '' : 's'}` : 'Add event'}
        </button>
      </form>

      {status && <p>{status}</p>}

      <h2>Recent events</h2>
      <div className="table-scroll"><table>
        <thead>
          <tr><th>Date</th><th>Student</th><th>Type</th><th>Category</th><th>Points</th>{profile?.role === 'admin' && <th></th>}</tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.event_id}>
              <td>{ev.event_date}</td>
              <td>{ev.students?.first_name} {ev.students?.last_name}</td>
              <td>{ev.type}</td>
              <td>{ev.category ?? '—'}</td>
              <td>{ev.points ?? '—'}</td>
              {profile?.role === 'admin' && (
                <td><button className="secondary" onClick={() => handleDelete(ev.event_id)}>Delete</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

export default function BehaviourPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p>Loading...</p>}>
        <BehaviourPageInner />
      </Suspense>
    </RequireAuth>
  );
}
