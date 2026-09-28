'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { formatUKDate } from '../../../lib/formatDate';
import { formatTimeRange } from '../../../lib/formatTime';
import { schoolToday } from '../../../lib/schoolTime';
import { OH_DAY_NAMES, loadOtherHalfSlots, staffByActivity, staffNames, fetchAll } from '../../../lib/otherHalf';

// Every Other Half absentee on one day, across all activities, so the
// coordinator can go and find them. Three lists:
//   - marked absent in an OH register, with what the earlier registers that
//     day say — someone present at period 6 and absent at OH is still on
//     site and the one to chase; someone absent all day is not
//   - on an activity whose register hasn't marked them yet
//   - no activity chosen for the day at all

function weekdayOf(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

// Today if it has an OH, otherwise the most recent day before it that does.
function latestOtherHalfDate(days) {
  const d = new Date(`${schoolToday()}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const wd = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' });
    if (days.includes(wd)) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return schoolToday();
}

const studentName = (s) => `${s.first_name} ${s.last_name}${s.preferred_name && s.preferred_name !== s.first_name ? ` (${s.preferred_name})` : ''}`;
const byName = (x, y) => x.year_group - y.year_group || x.last_name.localeCompare(y.last_name) || x.first_name.localeCompare(y.first_name);

function AbsenteesInner() {
  const [slots, setSlots] = useState(null);
  const [date, setDate] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    loadOtherHalfSlots().then((s) => {
      setSlots(s);
      setDate(latestOtherHalfDate(s.days));
    });
  }, []);

  useEffect(() => {
    async function load() {
      if (!slots || !date) return;
      const weekday = weekdayOf(date);
      if (!slots.byDay[weekday] || !slots.periodNumber) { setData({ noOh: true }); setLoading(false); return; }
      setLoading(true);
      setError(null);
      try {
        const { data: term } = await supabase
          .from('terms').select('term_id, term_name')
          .lte('start_date', date).gte('end_date', date)
          .order('start_date').limit(1).maybeSingle();
        if (!term) { setData({ noTerm: true }); setLoading(false); return; }

        const [{ data: acts }, choices, dayMarks, students, { data: codes }, { data: periods }] = await Promise.all([
          supabase.from('other_half_activities').select('*').eq('term_id', term.term_id).eq('day_of_week', weekday),
          fetchAll(() => supabase.from('other_half_choices').select('student_id, activity_id')
            .eq('term_id', term.term_id).eq('day_of_week', weekday).order('choice_id')),
          fetchAll(() => supabase.from('attendance').select('student_id, period_number, code, status, other_half_activity_id')
            .eq('attend_date', date).order('student_id').order('period_number')),
          fetchAll(() => supabase.from('students')
            .select('student_id, first_name, last_name, preferred_name, year_group, form_class, boarding_house')
            .eq('status', 'active').order('student_id')),
          supabase.from('attendance_codes').select('code, description, status'),
          supabase.from('school_day').select('period_number, short_label, period_name, start_time').eq('day_of_week', weekday),
        ]);

        const actIds = (acts || []).map((a) => a.activity_id);
        const { data: st } = actIds.length
          ? await supabase.from('other_half_activity_staff')
            .select('activity_id, staff_id, staff(staff_id, first_name, last_name)').in('activity_id', actIds)
          : { data: [] };

        setData({
          term,
          weekday,
          activities: Object.fromEntries((acts || []).map((a) => [a.activity_id, a])),
          staff: staffByActivity(st),
          choices,
          marks: dayMarks,
          students,
          codes: Object.fromEntries((codes || []).map((c) => [c.code, c])),
          periods: Object.fromEntries((periods || []).map((p) => [p.period_number, p])),
        });
        setLoadedAt(new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        setError(e.message || String(e));
      }
      setLoading(false);
    }
    load();
  }, [slots, date, reload]);

  if (!slots) return <p>Loading...</p>;

  const today = schoolToday();
  const header = (
    <>
      <p className="no-print"><a href="/other-half">← The Other Half</a></p>
      <h1>Other Half Absentees</h1>
      <div className="card no-print" style={{ alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
        <label>
          Date
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          {date && <span style={{ display: 'block', fontSize: '0.75rem', color: '#666', marginTop: '0.2rem' }}>{formatUKDate(date, { weekday: true })}</span>}
        </label>
        <label>
          Year
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All years</option>
            {[7, 8, 9, 10, 11, 12].map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setReload((n) => n + 1)}>Refresh</button>
        <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
        {loadedAt && <span style={{ color: '#666', fontSize: '0.85em' }}>Updated {loadedAt}</span>}
      </div>
    </>
  );

  if (loading || !data) return <div>{header}<p>Loading...</p></div>;
  if (error) return <div>{header}<p style={{ color: '#b91c1c' }}>Error: {error}</p></div>;
  if (data.noOh) {
    return (
      <div>{header}
        <p>There&apos;s no Other Half on {formatUKDate(date, { weekday: true })}. It runs on {slots.days.map((d) => OH_DAY_NAMES[d]).join(', ')}.</p>
      </div>
    );
  }
  if (data.noTerm) return <div>{header}<p>{formatUKDate(date, { weekday: true })} isn&apos;t in any term.</p></div>;

  const { activities, staff, codes, periods } = data;
  const ohPeriod = slots.periodNumber;
  const studentById = Object.fromEntries(data.students.map((s) => [s.student_id, s]));
  const choiceByStudent = Object.fromEntries(data.choices.map((c) => [c.student_id, c.activity_id]));

  const ohMark = {};
  const earlierMarks = {};
  for (const m of data.marks) {
    if (m.period_number === ohPeriod) ohMark[m.student_id] = m;
    else (earlierMarks[m.student_id] ||= []).push(m);
  }

  const periodOrder = (n) => periods[n]?.start_time || String(n).padStart(2, '0');
  const periodLabel = (n) => {
    const p = periods[n];
    if (!p) return `P${n}`;
    return `${p.short_label || p.period_name}${p.start_time ? ` (${p.start_time.slice(0, 5)})` : ''}`;
  };

  // What the day's other registers say about a student, for deciding
  // whether they're on site. Only periods before the OH count.
  function earlierToday(studentId) {
    const ohStart = periods[ohPeriod]?.start_time;
    const list = (earlierMarks[studentId] || [])
      .filter((m) => !ohStart || !periods[m.period_number]?.start_time || periods[m.period_number].start_time < ohStart)
      .sort((a, b) => periodOrder(a.period_number).localeCompare(periodOrder(b.period_number)));
    if (list.length === 0) return { kind: 'none', text: 'No earlier registers today' };
    const seen = list.filter((m) => m.status === 'present' || m.status === 'late');
    if (seen.length) {
      const last = seen[seen.length - 1];
      return { kind: 'onSite', text: `In school — last marked present ${periodLabel(last.period_number)}` };
    }
    const lastCode = list[list.length - 1].code;
    return { kind: 'awayAllDay', text: `Absent all day${lastCode ? ` — ${codes[lastCode]?.description || lastCode}` : ''}` };
  }

  const inYear = (s) => s && (!yearFilter || String(s.year_group) === yearFilter);

  // 1. Marked absent in an OH register.
  const markedAbsent = Object.values(ohMark)
    .filter((m) => m.status === 'absent' || m.status === 'authorized_absence')
    .map((m) => ({ mark: m, student: studentById[m.student_id], earlier: earlierToday(m.student_id) }))
    .filter((r) => inYear(r.student));
  const rank = { onSite: 0, none: 1, awayAllDay: 2 };
  markedAbsent.sort((x, y) => rank[x.earlier.kind] - rank[y.earlier.kind] || byName(x.student, y.student));
  const toChase = markedAbsent.filter((r) => r.earlier.kind === 'onSite').length;

  // 2. On an activity, not marked yet.
  const notMarked = data.choices
    .filter((c) => !ohMark[c.student_id])
    .map((c) => ({ student: studentById[c.student_id], activityId: c.activity_id }))
    .filter((r) => inYear(r.student));
  const notMarkedByActivity = {};
  for (const r of notMarked) (notMarkedByActivity[r.activityId] ||= []).push(r.student);
  const notMarkedActivityIds = Object.keys(notMarkedByActivity)
    .sort((a, b) => (activities[a]?.activity_name || '').localeCompare(activities[b]?.activity_name || ''));

  // 3. No activity for the day (and not marked in one either).
  const noChoice = data.students
    .filter((s) => !choiceByStudent[s.student_id] && !ohMark[s.student_id] && inYear(s))
    .map((s) => ({ student: s, earlier: earlierToday(s.student_id) }))
    .sort((x, y) => byName(x.student, y.student));

  const activityLabel = (id) => {
    const a = activities[id];
    if (!a) return '—';
    return `${a.activity_name}${a.room ? ` · ${a.room}` : ''}`;
  };
  const earlierStyle = (kind) => (kind === 'onSite'
    ? { color: '#b91c1c', fontWeight: 600 }
    : { color: '#666' });

  const slot = slots.byDay[data.weekday];

  return (
    <div>
      {header}
      <p style={{ color: '#666', marginTop: 0 }}>
        {formatUKDate(date, { weekday: true })}
        {slot ? ` · ${formatTimeRange(slot.start_time, slot.end_time)}` : ''}
        {` · ${data.term.term_name}`}
        {yearFilter ? ` · Year ${yearFilter}` : ''}
      </p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>Marked absent ({markedAbsent.length})</h2>
        {toChase > 0 && (
          <p style={{ marginTop: 0, color: '#b91c1c', fontWeight: 600 }}>
            {toChase} {toChase === 1 ? 'was' : 'were'} in school earlier today — find {toChase === 1 ? 'this student' : 'these students'} first.
          </p>
        )}
        {markedAbsent.length === 0 ? (
          <p>Nobody has been marked absent in an Other Half register.</p>
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>House</th><th>Activity</th><th>Staff</th><th>Code</th><th>Earlier today</th></tr></thead>
            <tbody>
              {markedAbsent.map(({ mark, student, earlier }) => (
                <tr key={mark.student_id}>
                  <td><strong>{studentName(student)}</strong></td>
                  <td>{student.year_group}</td>
                  <td>{student.form_class || '—'}</td>
                  <td>{student.boarding_house || '—'}</td>
                  <td>{activityLabel(mark.other_half_activity_id)}</td>
                  <td>{staffNames(staff[mark.other_half_activity_id]) || '—'}</td>
                  <td>{mark.code}{codes[mark.code] ? ` — ${codes[mark.code].description}` : ''}</td>
                  <td style={earlierStyle(earlier.kind)}>{earlier.text}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>Not marked yet ({notMarked.length})</h2>
        {notMarked.length === 0 ? (
          <p>Every student on an activity has been marked.</p>
        ) : (
          <>
            <p style={{ marginTop: 0, color: '#666' }}>On an activity whose register hasn&apos;t marked them. Chase the register first — they may well be there.</p>
            {notMarkedActivityIds.map((aid) => (
              <div key={aid} style={{ marginBottom: '0.75rem' }}>
                <h3 style={{ margin: '0.5rem 0 0.25rem' }}>
                  {activityLabel(aid)}
                  <span style={{ fontWeight: 400, color: '#666' }}> · {staffNames(staff[aid]) || 'No staff assigned'} · {notMarkedByActivity[aid].length} not marked</span>
                  {' '}<a className="no-print" style={{ fontWeight: 400, fontSize: '0.85em' }} href={`/other-half/register?activityId=${aid}&date=${date}`}>Open register</a>
                </h3>
                <p style={{ margin: 0 }}>
                  {notMarkedByActivity[aid].sort(byName).map((s) => `${studentName(s)} (${s.form_class || `Y${s.year_group}`})`).join(', ')}
                </p>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <h2 style={{ marginTop: 0 }}>No activity chosen ({noChoice.length})</h2>
        {noChoice.length === 0 ? (
          <p>Every student has an activity for {OH_DAY_NAMES[data.weekday]}.</p>
        ) : (
          <>
            <p style={{ marginTop: 0, color: '#666' }}>
              No register will ever mark these students. Place them at <a href="/other-half/choices">Student Choices</a>.
            </p>
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Year</th><th>Form</th><th>House</th><th>Earlier today</th></tr></thead>
              <tbody>
                {noChoice.map(({ student, earlier }) => (
                  <tr key={student.student_id}>
                    <td><strong>{studentName(student)}</strong></td>
                    <td>{student.year_group}</td>
                    <td>{student.form_class || '—'}</td>
                    <td>{student.boarding_house || '—'}</td>
                    <td style={earlierStyle(earlier.kind)}>{earlier.text}</td>
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

export default function OtherHalfAbsenteesPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/other-half/absentees">
      <AbsenteesInner />
    </RequireResource></RequireAuth>
  );
}
