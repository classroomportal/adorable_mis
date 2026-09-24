'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { formatUKDate } from '../../../lib/formatDate';
import { formatTimeRange } from '../../../lib/formatTime';
import { schoolToday, minutesSinceSchoolTime } from '../../../lib/schoolTime';
import { OH_DAY_NAMES, loadOtherHalfSlots, staffByActivity, staffNames } from '../../../lib/otherHalf';

const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The latest date on or before today that falls on this weekday — the
// register a teacher opening "their Tuesday activity" on a Thursday means.
function mostRecentDateFor(dayOfWeek) {
  const today = new Date(`${schoolToday()}T00:00:00`);
  const todayIdx = today.getDay() === 0 ? 7 : today.getDay();
  const back = (todayIdx - WEEKDAY_INDEX[dayOfWeek] + 7) % 7;
  const d = new Date(today);
  d.setDate(today.getDate() - back);
  return isoLocal(d);
}

function weekdayOf(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

function RegisterInner() {
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const activityId = Number(searchParams.get('activityId')) || null;
  const [activity, setActivity] = useState(null);
  const [term, setTerm] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [slots, setSlots] = useState({ periodNumber: null, byDay: {} });
  const [codes, setCodes] = useState([]);
  const [date, setDate] = useState(searchParams.get('date') || '');
  const [roster, setRoster] = useState([]);
  const [marks, setMarks] = useState({});
  const [lateMinutes, setLateMinutes] = useState({});
  const [elsewhere, setElsewhere] = useState({}); // student_id -> activity name, when already marked in another activity
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStatic() {
      if (!activityId) { setLoading(false); return; }
      const [{ data: a }, s, { data: cd }, { data: st }] = await Promise.all([
        supabase.from('other_half_activities').select('*, terms(*)').eq('activity_id', activityId).maybeSingle(),
        loadOtherHalfSlots(),
        supabase.from('attendance_codes').select('*').order('code'),
        supabase.from('other_half_activity_staff').select('activity_id, staff_id, staff(staff_id, first_name, last_name)').eq('activity_id', activityId),
      ]);
      setActivity(a || null);
      setTerm(a?.terms || null);
      setSlots(s);
      setCodes(cd || []);
      setStaffList(staffByActivity(st)[activityId] || []);
      if (a && !searchParams.get('date')) setDate(mostRecentDateFor(a.day_of_week));
      if (!a) setLoading(false);
    }
    loadStatic();
  }, [activityId]);

  useEffect(() => {
    async function loadRoster() {
      if (!activity || !date || !slots.periodNumber) return;
      setLoading(true);
      const { data: ch } = await supabase
        .from('other_half_choices')
        .select('students(student_id, first_name, last_name, year_group, form_class, status)')
        .eq('activity_id', activity.activity_id);
      const list = (ch || []).map((r) => r.students).filter((s) => s && s.status === 'active')
        .sort((x, y) => x.last_name.localeCompare(y.last_name));

      // Anyone already marked in this activity on this date — kept on the
      // list even if they've since moved activity, so the record still shows.
      const ids = list.map((s) => s.student_id);
      const { data: markedHere } = await supabase
        .from('attendance')
        .select('student_id, code, minutes_late, other_half_activity_id, students(student_id, first_name, last_name, year_group, form_class, status)')
        .eq('attend_date', date)
        .eq('period_number', slots.periodNumber)
        .eq('other_half_activity_id', activity.activity_id);
      for (const m of markedHere || []) {
        if (m.students && !ids.includes(m.student_id)) { list.push(m.students); ids.push(m.student_id); }
      }

      const { data: existing } = ids.length
        ? await supabase
          .from('attendance')
          .select('student_id, code, minutes_late, other_half_activity_id, other_half_activities(activity_name)')
          .eq('attend_date', date)
          .eq('period_number', slots.periodNumber)
          .in('student_id', ids)
        : { data: [] };
      const prefill = {};
      const prefillMinutes = {};
      const other = {};
      for (const row of existing || []) {
        if (row.other_half_activity_id && row.other_half_activity_id !== activity.activity_id) {
          other[row.student_id] = row.other_half_activities?.activity_name || 'another activity';
          continue;
        }
        if (row.code) prefill[row.student_id] = row.code;
        if (row.minutes_late != null) prefillMinutes[row.student_id] = String(row.minutes_late);
      }
      setRoster(list);
      setMarks(prefill);
      setLateMinutes(prefillMinutes);
      setElsewhere(other);
      setStatus(null);
      setLoading(false);
    }
    loadRoster();
  }, [activity, date, slots.periodNumber]);

  const codeToStatus = Object.fromEntries(codes.map((c) => [c.code, c.status]));
  const isLateCode = (code) => !!code && codeToStatus[code] === 'late';
  const today = schoolToday();
  const slot = activity ? slots.byDay[activity.day_of_week] : null;

  const suggestedLateMinutes = (() => {
    if (date !== today || !slot) return null;
    const elapsed = minutesSinceSchoolTime(slot.start_time);
    const remaining = minutesSinceSchoolTime(slot.end_time);
    if (elapsed === null || remaining === null || elapsed < 1 || remaining > 0) return null;
    return String(elapsed);
  })();

  function setMark(studentId, code) {
    setMarks((m) => ({ ...m, [studentId]: code }));
    setLateMinutes((lm) => {
      if (!isLateCode(code)) {
        const { [studentId]: _dropped, ...rest } = lm;
        return rest;
      }
      if (lm[studentId] !== undefined || suggestedLateMinutes === null) return lm;
      return { ...lm, [studentId]: suggestedLateMinutes };
    });
  }

  function markAllPresent() {
    const all = { ...marks };
    roster.forEach((s) => { if (!elsewhere[s.student_id] && !all[s.student_id]) all[s.student_id] = '/'; });
    setMarks(all);
  }

  async function save(e) {
    e.preventDefault();
    const marked = Object.entries(marks).filter(([sid, code]) => code && !elsewhere[sid]);
    if (marked.length === 0) { setStatus('Mark at least one student.'); return; }
    const missing = marked.filter(([sid, code]) => isLateCode(code) && !String(lateMinutes[sid] ?? '').trim());
    if (missing.length) {
      const names = missing.map(([sid]) => roster.find((s) => String(s.student_id) === sid)).filter(Boolean).map((s) => `${s.first_name} ${s.last_name}`);
      setStatus(`Enter how many minutes late: ${names.join(', ')}.`);
      return;
    }
    if (date > today) { setStatus(`Can't save: ${formatUKDate(date, { weekday: true })} hasn't happened yet.`); return; }
    if (weekdayOf(date) !== activity.day_of_week
      && !window.confirm(`${activity.activity_name} runs on ${OH_DAY_NAMES[activity.day_of_week]}s, but ${formatUKDate(date, { weekday: true })} is a ${weekdayOf(date)}. Save anyway?`)) {
      return;
    }
    if (date < today && !window.confirm(`This saves the register for ${formatUKDate(date, { weekday: true })}, not today. Save anyway?`)) return;

    const attributeTo = profile?.staff_id ? { staff_id: profile.staff_id } : {};
    const rows = marked.map(([sid, code]) => {
      const typed = Number(lateMinutes[sid]);
      return {
        student_id: Number(sid),
        attend_date: date,
        period_number: slots.periodNumber,
        code,
        status: codeToStatus[code],
        minutes_late: isLateCode(code) && Number.isFinite(typed) ? Math.round(typed) : null,
        other_half_activity_id: activity.activity_id,
        ...attributeTo,
      };
    });
    setStatus('Saving...');
    const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,attend_date,period_number' });
    setStatus(error ? `Error: ${error.message}` : `Saved ${rows.length} mark${rows.length === 1 ? '' : 's'}.`);
  }

  if (!activityId) return <p>No activity chosen. Open a register from <a href="/other-half">The Other Half</a>.</p>;
  if (!activity && !loading) return <p>That activity doesn&apos;t exist. Back to <a href="/other-half">The Other Half</a>.</p>;
  if (!activity) return <p>Loading...</p>;

  const unmarked = roster.filter((s) => !marks[s.student_id] && !elsewhere[s.student_id]).length;

  return (
    <div>
      <p><a href="/other-half">← The Other Half</a></p>
      <h1>{activity.activity_name}</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {OH_DAY_NAMES[activity.day_of_week]}s{slot ? ` · ${formatTimeRange(slot.start_time, slot.end_time)}` : ''}
        {activity.room ? ` · ${activity.room}` : ''}
        {staffList.length ? ` · ${staffNames(staffList)}` : ''}
        {term ? ` · ${term.term_name}` : ''}
      </p>

      <div className="card">
        <label>
          Date
          <input type="date" value={date} max={today} min={term?.start_date} onChange={(e) => setDate(e.target.value)} />
          {date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(date, { weekday: true })}</span>}
        </label>
        {date && weekdayOf(date) !== activity.day_of_week && (
          <p style={{ color: '#b45309', fontWeight: 600, marginBottom: 0 }}>
            This activity runs on {OH_DAY_NAMES[activity.day_of_week]}s — {formatUKDate(date, { weekday: true })} isn&apos;t one.{' '}
            <button type="button" className="secondary" onClick={() => setDate(mostRecentDateFor(activity.day_of_week))}>Go to the latest {OH_DAY_NAMES[activity.day_of_week]}</button>
          </p>
        )}
      </div>

      <form onSubmit={save} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {loading ? <p>Loading...</p> : roster.length === 0 ? (
          <p>No students have chosen this activity yet.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
              <button type="button" className="secondary" onClick={markAllPresent}>Mark the rest present</button>
              <span style={{ color: '#666' }}>{roster.length} student{roster.length === 1 ? '' : 's'}{unmarked ? ` · ${unmarked} not marked yet` : ''}</span>
            </div>
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>Code</th><th>Minutes late</th></tr></thead>
              <tbody>
                {roster.map((s) => (
                  <tr key={s.student_id}>
                    <td>{s.first_name} {s.last_name}</td>
                    <td>{s.year_group}</td>
                    <td>{s.form_class || '—'}</td>
                    <td>
                      {elsewhere[s.student_id] ? (
                        <span style={{ color: '#666', fontSize: '0.85em' }}>Marked in {elsewhere[s.student_id]}</span>
                      ) : (
                        <select
                          value={marks[s.student_id] || ''}
                          onChange={(e) => setMark(s.student_id, e.target.value)}
                          aria-label={`Code — ${s.first_name} ${s.last_name}`}
                          style={{ width: '6.5rem' }}
                        >
                          <option value="">—</option>
                          {codes.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.description}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {isLateCode(marks[s.student_id]) ? (
                        <input
                          type="number" min="0" max="600" step="1" inputMode="numeric" required
                          aria-label={`Minutes late — ${s.first_name} ${s.last_name}`}
                          value={lateMinutes[s.student_id] ?? ''}
                          onChange={(e) => setLateMinutes((lm) => ({ ...lm, [s.student_id]: e.target.value }))}
                          style={{ width: '5rem' }}
                        />
                      ) : <span style={{ color: '#999', fontSize: '0.85em' }}>—</span>}
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
    </div>
  );
}

export default function OtherHalfRegisterPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half">
      <Suspense fallback={<p>Loading...</p>}>
        <RegisterInner />
      </Suspense>
    </RequireResource></RequireAuth>
  );
}
