'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import RequireResource from '../RequireResource';
import Link from 'next/link';
import { formatUKDate } from '../../lib/formatDate';
import { formatTimeRange } from '../../lib/formatTime';
import { schoolToday, minutesSinceSchoolTime } from '../../lib/schoolTime';
import { useAuth } from '../../lib/AuthContext';
import RegisterHomework from '../components/RegisterHomework';
import SaveBar, { useSaveStatus } from '../components/SaveBar';

function AttendanceInner() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [mentorClasses, setMentorClasses] = useState([]);
  const [subjectClasses, setSubjectClasses] = useState([]);
  const [codes, setCodes] = useState([]);
  const [date, setDate] = useState(searchParams.get('date') || schoolToday());
  const [periodNumber, setPeriodNumber] = useState(Number(searchParams.get('period')) || 1); // default: Registration
  const [classId, setClassId] = useState(searchParams.get('classId') || '');
  const [roster, setRoster] = useState([]);
  const [marks, setMarks] = useState({}); // student_id -> code
  const [lateMinutes, setLateMinutes] = useState({}); // student_id -> minutes late, as typed
  const [planned, setPlanned] = useState({}); // student_id -> true when the mark came from a planned absence (318)
  // Planned-absence marks can be changed only by the school office and the
  // attendance officer (389); for everyone else they're read-only here.
  const [isOffice, setIsOffice] = useState(false);
  // student_id -> 'code|minutes' as loaded or last saved, so Save sends only
  // the marks that changed and doesn't put this teacher's name on the rest.
  const [saved, setSaved] = useState({});
  const [slot, setSlot] = useState(null); // {start_time, end_time} of this class's slot in this period
  const [todaySoFar, setTodaySoFar] = useState({}); // student_id -> [{period_number, code, status}]
  const [lastGrades, setLastGrades] = useState({}); // student_id -> {grade, week_start_date}, for this class's subject
  const [gradesShown, setGradesShown] = useState(false); // the Last grade column, off by default
  const [status, setStatus] = useSaveStatus();
  const [loadingRoster, setLoadingRoster] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      const { data: p } = await supabase.from('periods').select('*').order('period_number');
      setPeriods(p || []);

      const { data: c } = await supabase
        .from('classes')
        .select('class_id, class_code, room, subject_id, subjects(subject_name), curriculum_blocks(block_name)')
        .not('class_code', 'is', null)
        .order('class_code');
      const all = c || [];
      setMentorClasses(all.filter((cl) => cl.curriculum_blocks?.block_name === 'Mentor'));
      setSubjectClasses(all.filter((cl) => cl.curriculum_blocks?.block_name !== 'Mentor'));

      const { data: cd } = await supabase.from('attendance_codes').select('*').order('code');
      setCodes(cd || []);

      const { data: office } = await supabase.rpc('is_attendance_office');
      setIsOffice(office === true);
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
      .select('students(student_id, first_name, last_name, status)')
      .eq('class_id', classId);
    const studentList = (sc || [])
      .map((row) => row.students)
      .filter((s) => s && s.status === 'active')
      .sort((a, b) => a.last_name.localeCompare(b.last_name));
    setRoster(studentList);

    const ids = studentList.map((s) => s.student_id);
    if (ids.length > 0) {
      const existingMarks = (cols) => supabase
        .from('attendance')
        .select(cols)
        .eq('attend_date', date)
        .eq('period_number', periodNumber)
        .in('student_id', ids);
      let { data: existing, error: existingError } = await existingMarks('student_id, code, minutes_late, planned_absence_id, other_half_activity_id');
      // Until migration 318 is run there's no planned_absence_id column; the
      // register must still show the marks already taken.
      if (existingError) ({ data: existing } = await existingMarks('student_id, code, minutes_late'));
      const prefill = {};
      const prefillMinutes = {};
      const plannedIds = {};
      const savedNow = {};
      (existing || []).forEach((row) => {
        if (row.code) prefill[row.student_id] = row.code;
        // A mark from an Other Half register is re-saved as this lesson's,
        // even unchanged, so it stops counting as OH attendance (385). A
        // planned-absence mark isn't: it stays the absence's, and only the
        // office can change it (389).
        savedNow[row.student_id] = row.other_half_activity_id && !row.planned_absence_id
          ? 'resave'
          : `${row.code || ''}|${row.minutes_late ?? ''}`;
        if (row.planned_absence_id) plannedIds[row.student_id] = true;
        if (row.minutes_late !== null && row.minutes_late !== undefined) {
          prefillMinutes[row.student_id] = String(row.minutes_late);
        }
      });
      setMarks(prefill);
      setLateMinutes(prefillMinutes);
      setPlanned(plannedIds);
      setSaved(savedNow);

      const { data: today } = await supabase
        .from('attendance_today')
        .select('student_id, period_number, code, status, minutes_late')
        .in('student_id', ids);
      const byStudent = {};
      (today || [])
        .filter((row) => row.period_number !== periodNumber) // don't repeat the current period
        .forEach((row) => {
          (byStudent[row.student_id] ||= []).push(row);
        });
      Object.values(byStudent).forEach((rows) => rows.sort((a, b) => a.period_number - b.period_number));
      setTodaySoFar(byStudent);

      // Most recent graded result in this class's subject, so the teacher has
      // it in front of them while taking the register. Newest first, so the
      // first row seen per student is the one to keep. Mentor groups carry no
      // subject results, so they're skipped.
      const subjectClass = subjectClasses.find((c) => String(c.class_id) === String(classId));
      const grades = {};
      if (subjectClass?.subject_id) {
        const { data: res } = await supabase
          .from('results')
          .select('student_id, grade, week_start_date')
          .eq('subject_id', subjectClass.subject_id)
          .not('grade', 'is', null)
          .in('student_id', ids)
          .order('week_start_date', { ascending: false })
          .order('created_at', { ascending: false });
        (res || []).forEach((row) => {
          if (!grades[row.student_id]) grades[row.student_id] = row;
        });
      }
      setLastGrades(grades);
    } else {
      setMarks({});
      setLateMinutes({});
      setPlanned({});
      setSaved({});
      setTodaySoFar({});
      setLastGrades({});
    }
    setLoadingRoster(false);
  }

  // The slot's start time is what "how late" is measured from, so it anchors
  // the hint next to the minutes box and seeds the suggested figure. A class
  // can sit in the same period on more than one day; only the slot for the
  // day being registered is relevant.
  useEffect(() => {
    async function loadSlot() {
      if (!classId || !date) { setSlot(null); return; }
      const dayLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
      const { data } = await supabase
        .from('timetable_slots')
        .select('start_time, end_time')
        .eq('class_id', classId)
        .eq('period_number', periodNumber)
        .eq('day_of_week', dayLabel)
        .maybeSingle();
      setSlot(data || null);
    }
    loadSlot();
  }, [classId, date, periodNumber]);

  function statusColor(status) {
    if (status === 'present') return '#1a7f37';
    if (status === 'late') return '#b08800';
    if (status === 'absent') return '#c62828';
    return '#6b6b6b'; // authorized_absence and anything else
  }

  // Only subject classes have a subject to show a grade for; mentor groups don't.
  // Grades are hidden until the teacher asks for them (the principal, 30 Sept
  // 2026): the register is often on the classroom screen.
  const canShowLastGrade = subjectClasses.some((c) => String(c.class_id) === String(classId));
  const showLastGrade = canShowLastGrade && gradesShown;

  const codeToStatus = Object.fromEntries(codes.map((c) => [c.code, c.status]));
  function isLateCode(code) {
    return !!code && codeToStatus[code] === 'late';
  }

  // periods.period_number is offset from the lesson number — Registration is
  // number 1, so number 2 is Lesson 1 — which made the old "P{number}" badges
  // read a lesson ahead of what they meant. short_label is the school's own
  // abbreviation (M, L1..L6), kept in the database rather than derived here.
  const periodByNumber = Object.fromEntries(periods.map((p) => [p.period_number, p]));
  function periodShort(n) {
    return periodByNumber[n]?.short_label || `P${n}`;
  }
  function periodLabel(n) {
    return periodByNumber[n]?.period_name || `Period ${n}`;
  }

  // Marking someone late is almost always done as they walk in, so offer the
  // minutes elapsed since the period started as a starting figure — but only
  // while the lesson is actually running. A register written up afterwards was
  // offering absurdities ("a late mark starts at 166 min" for a 45-minute
  // lesson); past the bell the teacher types the real figure instead.
  const suggestedLateMinutes = (() => {
    if (date !== schoolToday() || !slot?.start_time || !slot?.end_time) return null;
    const elapsed = minutesSinceSchoolTime(slot.start_time);
    const remaining = minutesSinceSchoolTime(slot.end_time);
    if (elapsed === null || remaining === null) return null;
    if (elapsed < 1 || remaining > 0) return null; // before it starts, or after it ends
    return String(elapsed);
  })();

  // subjectClasses too: with a classId from the URL, the roster can load before
  // the class list has, and the last-grade lookup needs the class's subject.
  useEffect(() => { loadRoster(); }, [classId, date, periodNumber, subjectClasses]);

  const today = schoolToday();
  const isFutureDate = !!date && date > today;
  const isPastDate = !!date && date < today;

  function setMark(studentId, code) {
    setMarks((m) => ({ ...m, [studentId]: code }));
    setLateMinutes((lm) => {
      if (!isLateCode(code)) {
        // The DB clears minutes_late for anything that isn't late anyway; drop
        // it here too so the box doesn't hold a figure that won't be saved.
        const { [studentId]: _dropped, ...rest } = lm;
        return rest;
      }
      if (lm[studentId] !== undefined) return lm;
      return suggestedLateMinutes === null ? lm : { ...lm, [studentId]: suggestedLateMinutes };
    });
  }

  function setLateMinutesFor(studentId, value) {
    setLateMinutes((lm) => ({ ...lm, [studentId]: value }));
  }

  function markAllPresent() {
    const all = {};
    // Planned-absence marks are left as they are, even for the office: a
    // student on a planned absence isn't present by default.
    roster.forEach((s) => {
      all[s.student_id] = planned[s.student_id] ? marks[s.student_id] : '/';
    });
    setMarks(all);
    setLateMinutes((lm) => Object.fromEntries(Object.entries(lm).filter(([sid]) => planned[sid])));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const marked = Object.entries(marks).filter(([, code]) => code);

    const missingMinutes = marked.filter(([student_id, code]) =>
      isLateCode(code) && !String(lateMinutes[student_id] ?? '').trim()
    );
    if (missingMinutes.length > 0) {
      const names = missingMinutes
        .map(([student_id]) => roster.find((s) => String(s.student_id) === String(student_id)))
        .filter(Boolean)
        .map((s) => `${s.first_name} ${s.last_name}`);
      setStatus(`Enter how many minutes late: ${names.join(', ')}.`);
      return;
    }

    // Nothing has ever written staff_id, so there was no record of who took a
    // register. Only send it when this login actually maps to a staff record —
    // an upsert only touches the columns it carries, so leaving the key out
    // keeps whoever marked it first rather than blanking them. Every row in a
    // batch must carry the same keys, which holds: it's one teacher saving.
    const attributeTo = profile?.staff_id ? { staff_id: profile.staff_id } : {};

    const changed = marked.filter(([student_id, code]) =>
      saved[student_id] !== `${code}|${isLateCode(code) ? (lateMinutes[student_id] ?? '') : ''}`);
    const rows = changed.map(([student_id, code]) => {
      const late = isLateCode(code);
      const typed = Number(lateMinutes[student_id]);
      return {
        student_id: Number(student_id),
        attend_date: date,
        period_number: periodNumber,
        code,
        status: codeToStatus[code],
        // Out-of-range values are rejected by the DB check constraint; clamping
        // a fat-fingered "700" to null would quietly lose the fact of lateness,
        // so let the error surface instead.
        minutes_late: late && Number.isFinite(typed) ? Math.round(typed) : null,
        other_half_activity_id: null,
        ...attributeTo,
      };
    });
    if (marked.length === 0) {
      setStatus('Mark at least one student.');
      return;
    }
    if (rows.length === 0) {
      setStatus('Nothing has changed since it was saved.');
      return;
    }
    // A mis-click on the timetable once saved a whole register five days in
    // the future, so today's looked untaken. The DB refuses future dates too
    // (migration 146); a past date is a legitimate correction, but confirm it.
    if (isFutureDate) {
      setStatus(`Can't save: ${formatUKDate(date, { weekday: true })} hasn't happened yet. Change the date to today.`);
      return;
    }
    if (isPastDate && !window.confirm(`This will save the register for ${formatUKDate(date, { weekday: true })}, not today (${formatUKDate(today, { weekday: true })}). Save anyway?`)) {
      setStatus('Not saved.');
      return;
    }
    setStatus('Saving...');
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,attend_date,period_number' });
    if (error) {
      setStatus(`Error: ${error.message}`);
      return;
    }
    setSaved((prev) => {
      const next = { ...prev };
      rows.forEach((r) => { next[r.student_id] = `${r.code}|${r.minutes_late ?? ''}`; });
      return next;
    });
    setStatus(`Saved ${rows.length} mark${rows.length === 1 ? '' : 's'}.`);
  }

  return (
    <div>
      <h1>Attendance</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label>
            Date
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            {date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(date, { weekday: true })}</span>}
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
        {isFutureDate && (
          <p style={{ color: '#b91c1c', fontWeight: 600, marginTop: '0.75rem', marginBottom: 0 }}>
            {formatUKDate(date, { weekday: true })} is in the future — a register can't be saved for it. Today is {formatUKDate(today, { weekday: true })}.{' '}
            <button type="button" className="secondary" onClick={() => setDate(today)}>Switch to today</button>
          </p>
        )}
        {isPastDate && (
          <p style={{ color: '#b45309', fontWeight: 600, marginTop: '0.75rem', marginBottom: 0 }}>
            You're looking at {formatUKDate(date, { weekday: true })}, not today ({formatUKDate(today, { weekday: true })}).{' '}
            <button type="button" className="secondary" onClick={() => setDate(today)}>Switch to today</button>
          </p>
        )}
      </div>

      {/* Only shows for classes the signed-in teacher can set homework for. */}
      {classId && <RegisterHomework classId={classId} />}

      {classId && (
        <form onSubmit={handleSubmit} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {loadingRoster ? <p>Loading roster...</p> : roster.length === 0 ? (
            <p>No students are linked to this class yet.</p>
          ) : (
            <>
              <SaveBar status={status}>
                <button type="submit" style={{ width: 'fit-content' }}>Save register</button>
              </SaveBar>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'stretch' }}>
                <button type="button" onClick={markAllPresent} className="secondary" style={{ width: 'fit-content' }}>
                  Mark all present
                </button>
                <Link href={`/behaviour?classId=${classId}&date=${date}`} className="secondary" style={{ width: 'fit-content', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '0.5rem 0.65rem', borderRadius: '6px', fontSize: '1rem', lineHeight: 'normal' }}>
                  Log behaviour for this class
                </Link>
                {canShowLastGrade && (
                  <button type="button" className="secondary" style={{ width: 'fit-content' }} onClick={() => setGradesShown((v) => !v)}>
                    {gradesShown ? 'Hide grades' : 'Show last grades'}
                  </button>
                )}
              </div>
              {slot?.start_time && (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#666' }}>
                  {periodLabel(periodNumber)} runs {formatTimeRange(slot.start_time, slot.end_time)}. Minutes late are counted from the start
                  {suggestedLateMinutes !== null && `, and a late mark starts at ${suggestedLateMinutes} min — change it if that isn't right`}.
                </p>
              )}
              <div className="table-scroll"><table>
                <thead><tr><th>Student</th>{showLastGrade && <th>Last grade</th>}<th>Today so far</th><th>Code</th><th>Minutes late</th></tr></thead>
                <tbody>
                  {roster.map((s) => (
                    <tr key={s.student_id}>
                      <td>{s.first_name} {s.last_name}</td>
                      {showLastGrade && (
                        <td>
                          {lastGrades[s.student_id] ? (
                            <span title={`Recorded w/c ${formatUKDate(lastGrades[s.student_id].week_start_date)}`} style={{ fontWeight: 600 }}>
                              {lastGrades[s.student_id].grade}
                            </span>
                          ) : (
                            <span style={{ color: '#999', fontSize: '0.85em' }}>—</span>
                          )}
                        </td>
                      )}
                      <td>
                        {(todaySoFar[s.student_id] || []).length === 0 ? (
                          <span style={{ color: '#999', fontSize: '0.85em' }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            {todaySoFar[s.student_id].map((row) => (
                              <span
                                key={row.period_number}
                                title={`${periodLabel(row.period_number)}: ${row.code}${row.minutes_late ? ` — ${row.minutes_late} minutes late` : ''}`}
                                style={{
                                  fontSize: '0.75em',
                                  fontWeight: 600,
                                  color: '#fff',
                                  background: statusColor(row.status),
                                  borderRadius: '4px',
                                  padding: '1px 6px',
                                }}
                              >
                                {periodShort(row.period_number)}:{row.code}{row.minutes_late ? ` +${row.minutes_late}m` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {/* Sized for the code itself; the open list still shows each description in full. */}
                        <select
                          value={marks[s.student_id] || ''}
                          onChange={(e) => setMark(s.student_id, e.target.value)}
                          aria-label={`Code — ${s.first_name} ${s.last_name}`}
                          title={codes.find((c) => c.code === marks[s.student_id])?.description || ''}
                          disabled={planned[s.student_id] && !isOffice}
                          style={{ width: '6.5rem' }}
                        >
                          <option value="">—</option>
                          {codes.map((c) => (
                            <option key={c.code} value={c.code}>{c.code} — {c.description}</option>
                          ))}
                        </select>
                        {/* Filled in by a planned absence (318); only the office can change it (389). */}
                        {planned[s.student_id] && (
                          <span title="Filled in from a planned absence. Only the school office or the attendance officer can change it." style={{ marginLeft: '0.35rem', fontSize: '0.75em', color: '#475569' }}>
                            planned
                          </span>
                        )}
                      </td>
                      <td>
                        {isLateCode(marks[s.student_id]) ? (
                          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.3rem' }}>
                            <input
                              type="number"
                              min="0"
                              max="600"
                              step="1"
                              inputMode="numeric"
                              required
                              aria-label={`Minutes late — ${s.first_name} ${s.last_name}`}
                              value={lateMinutes[s.student_id] ?? ''}
                              onChange={(e) => setLateMinutesFor(s.student_id, e.target.value)}
                              style={{ width: '5rem' }}
                            />
                            <span style={{ fontSize: '0.8em', color: '#666' }}>min</span>
                          </span>
                        ) : (
                          <span style={{ color: '#999', fontSize: '0.85em' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </form>
      )}
    </div>
  );
}

export default function AttendancePage() {
  return (
    <RequireAuth><RequireResource resourceKey="/attendance">
      <Suspense fallback={<p>Loading...</p>}>
        <AttendanceInner />
      </Suspense>
    </RequireResource></RequireAuth>
  );
}
