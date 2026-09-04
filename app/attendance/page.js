'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';

function AttendanceInner() {
  const searchParams = useSearchParams();
  const [periods, setPeriods] = useState([]);
  const [mentorClasses, setMentorClasses] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [codes, setCodes] = useState([]);
  const [date, setDate] = useState(searchParams.get('date') || new Date().toISOString().slice(0, 10));
  const [periodNumber, setPeriodNumber] = useState(Number(searchParams.get('period')) || 1); // default: Registration
  const [classId, setClassId] = useState(searchParams.get('classId') || '');
  const [roster, setRoster] = useState([]);
  const [marks, setMarks] = useState({}); // student_id -> code
  const [todaySoFar, setTodaySoFar] = useState({}); // student_id -> [{period_number, code, status}]
  const [status, setStatus] = useState(null);
  const [loadingRoster, setLoadingRoster] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      const { data: p } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(p || []);

      const { data: c } = await supabase
        .from('classes')
        .select('class_id, class_code, room, subjects(subject_name), curriculum_blocks(block_name)')
        .not('class_code', 'is', null)
        .order('class_code');
      const all = c || [];
      setMentorClasses(all.filter((cl) => cl.curriculum_blocks?.block_name === 'Mentor'));
      setSubjectClasses(all.filter((cl) => cl.curriculum_blocks?.block_name !== 'Mentor'));

      const { data: cd } = await supabase.from('attendance_codes').select('*').order('code');
      setCodes(cd || []);
    }
    loadOptions();
  }, []);

  async function loadRoster() {
    if (!classId) {
      setRoster([]);
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

    const ids = studentList.map((s) => s.student_id);
    if (ids.length > 0) {
      const { data: existing } = await supabase
        .from('attendance')
        .select('student_id, code')
        .eq('attend_date', date)
        .eq('period_number', periodNumber)
        .in('student_id', ids);
      const prefill = {};
      (existing || []).forEach((row) => { if (row.code) prefill[row.student_id] = row.code; });
      setMarks(prefill);

      const { data: today } = await supabase
        .from('attendance_today')
        .select('student_id, period_number, code, status')
        .in('student_id', ids);
      const byStudent = {};
      (today || [])
        .filter((row) => row.period_number !== periodNumber) // don't repeat the current period
        .forEach((row) => {
          (byStudent[row.student_id] ||= []).push(row);
        });
      Object.values(byStudent).forEach((rows) => rows.sort((a, b) => a.period_number - b.period_number));
      setTodaySoFar(byStudent);
    } else {
      setMarks({});
      setTodaySoFar({});
    }
    setLoadingRoster(false);
  }

  function statusColor(status) {
    if (status === 'present') return '#1a7f37';
    if (status === 'late') return '#b08800';
    if (status === 'absent') return '#c62828';
    return '#6b6b6b'; // authorized_absence and anything else
  }

  useEffect(() => { loadRoster(); }, [classId, date, periodNumber]);

  function setMark(studentId, code) {
    setMarks((m) => ({ ...m, [studentId]: code }));
  }

  function markAllPresent() {
    const all = {};
    roster.forEach((s) => { all[s.student_id] = '/'; });
    setMarks(all);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const codeToStatus = Object.fromEntries(codes.map((c) => [c.code, c.status]));
    const rows = Object.entries(marks)
      .filter(([, code]) => code)
      .map(([student_id, code]) => ({
        student_id: Number(student_id),
        attend_date: date,
        period_number: periodNumber,
        code,
        status: codeToStatus[code],
      }));
    if (rows.length === 0) {
      setStatus('Mark at least one student.');
      return;
    }
    setStatus('Saving...');
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,attend_date,period_number' });
    if (error) setStatus(`Error: ${error.message}`);
    else setStatus(`Saved ${rows.length} marks.`);
  }

  return (
    <div>
      <h1>Attendance</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label>
            Period
            <select value={periodNumber} onChange={(e) => setPeriodNumber(Number(e.target.value))}>
              {periods.map((p) => (
                <option key={p.period_number} value={p.period_number}>{p.period_name}</option>
              ))}
            </select>
          </label>

          <label>
            Class / group
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Select...</option>
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
        </div>
      </div>

      {classId && (
        <form onSubmit={handleSubmit} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {loadingRoster ? <p>Loading roster...</p> : roster.length === 0 ? (
            <p>No students are linked to this class yet.</p>
          ) : (
            <>
              <button type="button" onClick={markAllPresent} className="secondary" style={{ width: 'fit-content', marginBottom: '1rem' }}>
                Mark all present
              </button>
              <div className="table-scroll"><table>
                <thead><tr><th>Student</th><th>Today so far</th><th>Code</th></tr></thead>
                <tbody>
                  {roster.map((s) => (
                    <tr key={s.student_id}>
                      <td>{s.first_name} {s.last_name}</td>
                      <td>
                        {(todaySoFar[s.student_id] || []).length === 0 ? (
                          <span style={{ color: '#999', fontSize: '0.85em' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {todaySoFar[s.student_id].map((row) => (
                              <span
                                key={row.period_number}
                                title={`Period ${row.period_number}: ${row.code}`}
                                style={{
                                  fontSize: '0.75em',
                                  fontWeight: 600,
                                  color: '#fff',
                                  background: statusColor(row.status),
                                  borderRadius: '4px',
                                  padding: '1px 6px',
                                }}
                              >
                                P{row.period_number}:{row.code}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <select value={marks[s.student_id] || ''} onChange={(e) => setMark(s.student_id, e.target.value)}>
                          <option value="">—</option>
                          {codes.map((c) => (
                            <option key={c.code} value={c.code}>{c.code} — {c.description}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>

              <button type="submit" style={{ marginTop: '1rem', width: 'fit-content' }}>Save register</button>
            </>
          )}
          {status && <p>{status}</p>}
        </form>
      )}
    </div>
  );
}

export default function AttendancePage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p>Loading...</p>}>
        <AttendanceInner />
      </Suspense>
    </RequireAuth>
  );
}
