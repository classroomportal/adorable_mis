'use client';
import { useEffect, useState, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function StudentDetail() {
  const params = useParams();
  const id = params.id;
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [student, setStudent] = useState(null);
  const [parents, setParents] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [behaviour, setBehaviour] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  async function loadAll() {
    const { data: s, error: sErr } = await supabase
      .from('students')
      .select('*')
      .eq('student_id', id)
      .maybeSingle();

    if (sErr) { setError(sErr.message); setLoading(false); return; }
    setStudent(s);
    setEditForm(s);
    if (!s) { setLoading(false); return; }

    const { data: p } = await supabase
      .from('student_parent')
      .select('is_primary_contact, parents(first_name,last_name,phone,email,relationship_type)')
      .eq('student_id', id);
    setParents(p || []);

    const { data: pr } = await supabase.from('periods').select('*').order('period_number');
    setPeriods(pr || []);

    const { data: tt } = await supabase
      .from('student_class')
      .select('classes(class_id, room, subjects(subject_name), timetable_slots(day_of_week, period_number, start_time, end_time))')
      .eq('student_id', id);
    setTimetable(tt || []);

    const { data: be } = await supabase
      .from('behaviour_events')
      .select('*')
      .eq('student_id', id)
      .order('event_date', { ascending: false });
    setBehaviour(be || []);

    const { data: att } = await supabase
      .from('attendance')
      .select('*')
      .eq('student_id', id)
      .order('attend_date', { ascending: false })
      .limit(30);
    setAttendance(att || []);

    const { data: r } = await supabase
      .from('results')
      .select('*, subjects(subject_name)')
      .eq('student_id', id)
      .order('week_start_date', { ascending: false });
    setResults(r || []);

    setLoading(false);
  }

  useEffect(() => { loadAll(); }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    setSaveStatus('Saving...');
    const { error } = await supabase
      .from('students')
      .update({
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        dob: editForm.dob,
        year_group: editForm.year_group,
        form_class: editForm.form_class,
        admission_date: editForm.admission_date,
        gender: editForm.gender,
        address: editForm.address,
        medical_notes: editForm.medical_notes,
        status: editForm.status,
      })
      .eq('student_id', id);
    if (error) setSaveStatus(`Error: ${error.message}`);
    else {
      setSaveStatus('Saved.');
      setEditing(false);
      loadAll();
    }
  }

  // Build a lookup: cellMap[day][period_number] = { subject, room }
  const cellMap = {};
  timetable.forEach((tc) => {
    (tc.classes?.timetable_slots || []).forEach((slot) => {
      cellMap[`${slot.day_of_week}-${slot.period_number}`] = {
        subject: tc.classes?.subjects?.subject_name,
        room: tc.classes?.room,
      };
    });
  });

  if (loading) return <p>Loading...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;
  if (!student) return <p>Student not found (id: {id}).</p>;

  return (
    <div>
      <h1>{student.first_name} {student.last_name}</h1>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Core Data</h2>
          {isAdmin && !editing && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}
        </div>

        {!editing ? (
          <>
            <p><strong>DOB:</strong> {student.dob}</p>
            <p><strong>Year group:</strong> {student.year_group} &nbsp; <strong>Form:</strong> {student.form_class}</p>
            <p><strong>Admission date:</strong> {student.admission_date}</p>
            <p><strong>Gender:</strong> {student.gender || '—'}</p>
            <p><strong>Address:</strong> {student.address || '—'}</p>
            <p><strong>Medical notes:</strong> {student.medical_notes || '—'}</p>
            <p><strong>Status:</strong> {student.status}</p>
          </>
        ) : (
          <form onSubmit={handleSave} style={{ marginTop: '1rem' }}>
            <label>First name
              <input value={editForm.first_name || ''} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
            </label>
            <label>Last name
              <input value={editForm.last_name || ''} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
            </label>
            <label>DOB
              <input type="date" value={editForm.dob || ''} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} />
            </label>
            <label>Year group
              <input type="number" value={editForm.year_group || ''} onChange={(e) => setEditForm({ ...editForm, year_group: e.target.value })} />
            </label>
            <label>Form class
              <input value={editForm.form_class || ''} onChange={(e) => setEditForm({ ...editForm, form_class: e.target.value })} />
            </label>
            <label>Admission date
              <input type="date" value={editForm.admission_date || ''} onChange={(e) => setEditForm({ ...editForm, admission_date: e.target.value })} />
            </label>
            <label>Gender
              <input value={editForm.gender || ''} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} />
            </label>
            <label>Address
              <input value={editForm.address || ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </label>
            <label>Medical notes
              <input value={editForm.medical_notes || ''} onChange={(e) => setEditForm({ ...editForm, medical_notes: e.target.value })} />
            </label>
            <label>Status
              <select value={editForm.status || 'active'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="left">Left</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit">Save</button>
              <button type="button" className="secondary" onClick={() => { setEditing(false); setEditForm(student); }}>Cancel</button>
            </div>
            {saveStatus && <p>{saveStatus}</p>}
          </form>
        )}
      </div>

      <div className="card">
        <h2>Parents / Guardians</h2>
        {parents.length === 0 ? <p>None on record.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th>Primary</th></tr></thead>
              <tbody>
                {parents.map((pp, i) => (
                  <tr key={i}>
                    <td>{pp.parents?.first_name} {pp.parents?.last_name}</td>
                    <td>{pp.parents?.relationship_type}</td>
                    <td>{pp.parents?.phone}</td>
                    <td>{pp.parents?.email}</td>
                    <td>{pp.is_primary_contact ? 'Yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Timetable</h2>
        <div className="table-scroll">
          <div className="timetable-grid">
            <div className="tt-head"></div>
            {DAYS.map((d) => <div key={d} className="tt-head">{d}</div>)}
            {periods.map((p) => (
              <Fragment key={p.period_number}>
                <div className="tt-cell tt-period-label">{p.period_name}</div>
                {DAYS.map((d) => {
                  const cell = cellMap[`${d}-${p.period_number}`];
                  return (
                    <div key={`${d}-${p.period_number}`} className={`tt-cell ${cell ? 'tt-filled' : ''}`}>
                      {cell ? <>{cell.subject}<br /><span style={{ opacity: 0.6 }}>{cell.room}</span></> : ''}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Attendance</h2>
        {attendance.length === 0 ? <p>No attendance recorded.</p> : (
          <>
            <p>
              <strong>{attendance.filter(a => a.status === 'present').length}</strong> present, {' '}
              <strong>{attendance.filter(a => a.status === 'late').length}</strong> late, {' '}
              <strong>{attendance.filter(a => a.status === 'authorized_absence').length}</strong> authorized absence, {' '}
              <strong>{attendance.filter(a => a.status === 'absent').length}</strong> unauthorized absence
            </p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {attendance.map((a) => (
                    <tr key={a.attendance_id}><td>{a.attend_date}</td><td>{a.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Behaviour</h2>
        {behaviour.length === 0 ? <p>No events logged.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Points</th><th>Description</th></tr></thead>
              <tbody>
                {behaviour.map((b) => (
                  <tr key={b.event_id}>
                    <td>{b.event_date}</td>
                    <td><span className={`badge ${b.type === 'positive' ? 'badge-positive' : 'badge-negative'}`}>{b.type}</span></td>
                    <td>{b.category}</td>
                    <td>{b.points}</td>
                    <td>{b.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Results</h2>
        {results.length === 0 ? <p>No results recorded.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Week</th><th>Subject</th><th>Score</th><th>Grade</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.result_id}>
                    <td>{r.week_start_date}</td>
                    <td>{r.subjects?.subject_name}</td>
                    <td>{r.score ?? '—'}{r.max_score ? ` / ${r.max_score}` : ''}</td>
                    <td>{r.grade ?? '—'}</td>
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

export default function Page() {
  return <RequireAuth><StudentDetail /></RequireAuth>;
}
