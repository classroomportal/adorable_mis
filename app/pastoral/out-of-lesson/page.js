'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolClock } from '../../../lib/schoolTime';

// Students who were marked present earlier today but aren't in a lesson now
// (migration 307, students_out_of_lesson()): either marked absent in this
// period's register, or with nothing timetabled now. Authorised absences and
// registers not yet taken are left out. Refreshes every minute.

const studentName = (s) => `${s.first_name} ${s.last_name}${s.preferred_name && s.preferred_name !== s.first_name ? ` (${s.preferred_name})` : ''}`;

function StudentTable({ rows, showLesson }) {
  return (
    <div className="table-scroll"><table>
      <thead>
        <tr>
          <th>Student</th>
          <th>Year</th>
          <th>Mentor group</th>
          <th>House</th>
          <th>Last seen</th>
          {showLesson && <th>Should be in</th>}
          {showLesson && <th>Marked</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.student_id}>
            <td><a href={`/students/${s.student_id}`}>{studentName(s)}</a></td>
            <td>{s.year_group}</td>
            <td>{s.form_class || '—'}</td>
            <td>{s.boarding_house || '—'}</td>
            <td>{s.last_seen_period}</td>
            {showLesson && <td>{s.lesson}{s.teacher ? ` (${s.teacher})` : ''}</td>}
            {showLesson && <td>{s.absence_code || 'Absent'}</td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function OutOfLessonInner() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    const { data: d, error: e } = await supabase.rpc('students_out_of_lesson');
    if (e) { setError(e.message); return; }
    setError(null);
    setData(d);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const period = data?.period;
  const students = data?.students || [];
  const absent = students.filter((s) => s.reason === 'marked_absent');
  const noLesson = students.filter((s) => s.reason === 'no_lesson');

  return (
    <div>
      <h1>Out of Lesson</h1>
      <p>
        Students who were marked present or late earlier today but aren&apos;t in a lesson now:
        marked absent in this period&apos;s register, or with nothing on their timetable this period.
        Authorised absences (illness, appointments) and registers not yet taken aren&apos;t counted.
      </p>
      <p style={{ color: '#5b6472', fontSize: '0.85rem' }}>
        School time now: <strong>{schoolClock()}</strong> (Lagos)
        {period && <> · {period.period_name}, {(period.start_time || '').slice(0, 5)}–{(period.end_time || '').slice(0, 5)}</>}
      </p>

      {error && <div className="card" style={{ color: '#b42318' }}>{error}</div>}
      {!data && !error && <div className="card"><p>Loading...</p></div>}
      {data && !period && (
        <div className="card"><p>No lesson is running right now (break, before or after the school day, or outside term).</p></div>
      )}
      {period && (
        <>
          <div className="card">
            <h2>Marked absent this period ({absent.length})</h2>
            {absent.length === 0 ? <p>Nobody.</p> : <StudentTable rows={absent} showLesson />}
          </div>
          <div className="card">
            <h2>No lesson this period ({noLesson.length})</h2>
            {noLesson.length === 0 ? <p>Nobody.</p> : <StudentTable rows={noLesson} />}
          </div>
        </>
      )}
    </div>
  );
}

export default function OutOfLessonPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/out-of-lesson"><OutOfLessonInner /></RequireResource></RequireAuth>;
}
