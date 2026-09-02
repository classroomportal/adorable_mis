'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function AttendanceInner() {
  const [students, setStudents] = useState([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState({});
  const [status, setStatus] = useState(null);
  const [recent, setRecent] = useState([]);

  async function loadRecent() {
    const { data } = await supabase
      .from('attendance')
      .select('attendance_id, attend_date, status, students(first_name,last_name)')
      .order('attend_date', { ascending: false })
      .limit(20);
    setRecent(data || []);
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('students').select('student_id, first_name, last_name').order('last_name');
      setStudents(data || []);
    }
    load();
    loadRecent();
  }, []);

  function setMark(studentId, value) {
    setMarks((m) => ({ ...m, [studentId]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('Saving...');
    const rows = Object.entries(marks).map(([student_id, status]) => ({
      student_id: Number(student_id),
      attend_date: date,
      status,
    }));
    if (rows.length === 0) {
      setStatus('Mark at least one student.');
      return;
    }
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,attend_date,period_number' });
    if (error) setStatus(`Error: ${error.message}`);
    else {
      setStatus('Saved.');
      setMarks({});
      loadRecent();
    }
  }

  return (
    <div>
      <h1>Attendance</h1>

      <form onSubmit={handleSubmit} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <table>
          <thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Authorized</th><th>Absent</th></tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.student_id}>
                <td>{s.first_name} {s.last_name}</td>
                {['present', 'late', 'authorized_absence', 'absent'].map((opt) => (
                  <td key={opt} style={{ textAlign: 'center' }}>
                    <input
                      type="radio"
                      name={`s-${s.student_id}`}
                      checked={marks[s.student_id] === opt}
                      onChange={() => setMark(s.student_id, opt)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <button type="submit" style={{ marginTop: '1rem', width: 'fit-content' }}>Save register</button>
        {status && <p>{status}</p>}
      </form>

      <h2>Recent entries</h2>
      <table>
        <thead><tr><th>Date</th><th>Student</th><th>Status</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.attendance_id}>
              <td>{r.attend_date}</td>
              <td>{r.students?.first_name} {r.students?.last_name}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AttendancePage() {
  return <RequireAuth><AttendanceInner /></RequireAuth>;
}
