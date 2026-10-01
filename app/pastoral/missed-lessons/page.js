'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolToday, schoolClock } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Students who were in school on a day but missed one or more lessons
// (migration 308, students_missed_lessons()): at least one present/late mark
// and at least one unauthorised absence that day, in any order. Authorised
// absences never count. Today refreshes every minute.

const studentName = (s) => `${s.first_name} ${s.last_name}${s.preferred_name && s.preferred_name !== s.first_name ? ` (${s.preferred_name})` : ''}`;

const BADGE = {
  present: { bg: '#e2f3e8', fg: '#1a7f37' },
  late: { bg: '#fbeed9', fg: '#9a5b00' },
  absent: { bg: '#fde2e1', fg: '#b42318' },
  authorized_absence: { bg: '#e7eaee', fg: '#475569' },
};

function DayMarks({ marks }) {
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.2rem' }}>
      {(marks || []).map((m, i) => {
        const c = BADGE[m.status] || BADGE.authorized_absence;
        return (
          <span key={i} title={`${m.period_name}: ${m.status.replace('_', ' ')}`}
            style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '0 0.3rem', fontSize: '0.75rem', fontWeight: 600 }}>
            {m.short_label || '?'}
          </span>
        );
      })}
    </span>
  );
}

function MissedLessonsInner() {
  const [date, setDate] = useState(schoolToday());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: d, error: e } = await supabase.rpc('students_missed_lessons', { p_date: date });
      if (cancelled) return;
      if (e) { setError(e.message); return; }
      setError(null);
      setData(d);
    }
    setData(null);
    load();
    if (date !== schoolToday()) return () => { cancelled = true; };
    const interval = setInterval(load, 60000); // today: refresh every minute
    return () => { cancelled = true; clearInterval(interval); };
  }, [date]);

  const students = data?.students || [];

  return (
    <div>
      <h1>Missed Lessons</h1>
      <p>
        Students who were marked present or late at some point in the day but were marked absent
        without a reason (unauthorised) in one or more lessons, before or after. Authorised absences
        (illness, appointments) don&apos;t count.
      </p>
      <p style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Day <input type="date" value={date} max={schoolToday()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        {date !== schoolToday() && <button type="button" onClick={() => setDate(schoolToday())}>Today</button>}
        {date === schoolToday() && <span style={{ color: '#5b6472', fontSize: '0.85rem' }}>School time now: <strong>{schoolClock()}</strong> (Lagos)</span>}
      </p>

      <div className="card">
        {error ? <p style={{ color: '#b42318' }}>{error}</p>
          : !data ? <p>Loading...</p>
          : students.length === 0 ? <p>Nobody missed a lesson on {formatUKDate(date)}.</p> : (
            <>
              <h2>{students.length} student{students.length === 1 ? '' : 's'} on {formatUKDate(date)}</h2>
              <div className="table-scroll"><table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Year</th>
                    <th>Mentor group</th>
                    <th>House</th>
                    <th>The day</th>
                    <th>Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.student_id}>
                      <td><a href={`/students/${s.student_id}`}>{studentName(s)}</a></td>
                      <td>{s.year_group}</td>
                      <td>{s.form_class || '—'}</td>
                      <td>{s.boarding_house || '—'}</td>
                      <td><DayMarks marks={s.day_marks} /></td>
                      <td>
                        {(s.missed || []).map((m, i) => (
                          <div key={i}>
                            <strong>{m.period_name}</strong>
                            {m.lesson ? ` · ${m.lesson}` : ''}
                            {m.teacher ? ` (${m.teacher})` : ''}
                            <span style={{ color: '#5b6472' }}>
                              {m.code ? ` · ${m.code}` : ''}
                              {m.marked_by ? ` · marked by ${m.marked_by}` : ''}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
      </div>
    </div>
  );
}

export default function MissedLessonsPage() {
  return <RequireAuth><RequireResource resourceKey="/pastoral/missed-lessons"><MissedLessonsInner /></RequireResource></RequireAuth>;
}
