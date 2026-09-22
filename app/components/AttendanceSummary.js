'use client';
// The attendance read-out shared by a student's record and the parent portal.
// Both answer the same three questions — where is this child today, how has
// this week gone, how much school have they missed this year — so both render
// from here rather than growing two versions that drift apart.
import { formatUKDate } from '../../lib/formatDate';

export const ATT_STATUS_LABEL = {
  present: 'Present',
  late: 'Late',
  authorized_absence: 'Authorised absence',
  absent: 'Unauthorised absence',
};

const ATT_STATUS_COLOUR = {
  present: '#1a7f37',
  late: '#b08800',
  authorized_absence: '#6b6b6b',
  absent: '#c62828',
};

const ATT_SCOPE_LABEL = { today: 'Today', week: 'This week', year: 'This year so far' };

// Lateness is entered in minutes but adds up into hours over a term, which is
// the figure that actually means something in a conversation about it.
export function formatLateness(minutes) {
  const total = Number(minutes) || 0;
  if (total === 0) return 'none';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function AttendanceMark({ status, code }) {
  if (!status) return <span style={{ color: '#97a0ad' }}>Not marked</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.35rem' }}>
      <span
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#fff',
          background: ATT_STATUS_COLOUR[status] || '#6b6b6b',
          borderRadius: '4px',
          padding: '1px 6px',
        }}
      >
        {code || '?'}
      </span>
      {ATT_STATUS_LABEL[status] || status}
    </span>
  );
}

function AttendanceScopeCard({ row }) {
  const sessions = Number(row.sessions);
  const late = Number(row.late);
  const attended = Number(row.present) + late;
  const pct = sessions > 0 ? Math.round((attended / sessions) * 100) : null;
  const unrecordedLate = late - Number(row.late_with_minutes);
  const counts = [
    ['Present', Number(row.present)],
    ['Late', late],
    ['Authorised absence', Number(row.authorized_absence)],
    ['Unauthorised absence', Number(row.absent)],
  ];
  return (
    <div className="att-scope">
      <div className="att-scope-label">{ATT_SCOPE_LABEL[row.scope] || row.scope}</div>
      <div className="att-scope-headline">{pct === null ? '—' : `${pct}%`}</div>
      <div className="att-scope-sub">
        {sessions === 0
          ? 'No registers yet'
          : `${attended} of ${sessions} session${sessions === 1 ? '' : 's'} attended`}
      </div>
      {row.scope !== 'today' && row.window_start && (
        <div className="att-scope-sub">since {formatUKDate(row.window_start)}</div>
      )}
      <ul className="att-scope-breakdown">
        {counts.map(([label, n]) => (
          <li key={label} className={n === 0 ? 'att-zero' : undefined}>
            <span>{label}</span><span>{n}</span>
          </li>
        ))}
        <li className="att-late-total">
          <span>Time late</span><span>{formatLateness(row.late_minutes)}</span>
        </li>
      </ul>
      {/* Marks taken before minutes were recorded would otherwise be counted as
          nought minutes late, quietly flattering the total. */}
      {unrecordedLate > 0 && (
        <div className="att-scope-sub" style={{ marginTop: '0.3rem' }}>
          {unrecordedLate} late mark{unrecordedLate === 1 ? '' : 's'} with no time recorded
        </div>
      )}
    </div>
  );
}

export function AttendanceScopeCards({ summary }) {
  return (
    <div className="att-scopes">
      {summary.map((row) => <AttendanceScopeCard key={row.scope} row={row} />)}
    </div>
  );
}

// Today's register read as the child's day: every lesson they are timetabled
// for, marked or not, plus any mark taken in a period with no timetabled lesson
// (evening prep, a cover arrangement). An unmarked lesson is as worth seeing as
// a marked one — it is the register nobody took.
//
// `lessonFor(period_number)` returns `{ subject, time }` or nothing; the two
// pages build their timetable lookups differently, so each passes its own.
export function attendanceTodayLessons({ periods, marks, lessonFor }) {
  const byPeriod = Object.fromEntries((marks || []).map((a) => [a.period_number, a]));
  return (periods || [])
    .map((p) => {
      const lesson = lessonFor(p.period_number);
      const mark = byPeriod[p.period_number];
      if (!lesson && !mark) return null;
      return {
        period_number: p.period_number,
        period_name: p.period_name,
        subject: lesson?.subject || null,
        time: lesson?.time || null,
        status: mark?.status || null,
        code: mark?.code || null,
        minutes_late: mark?.minutes_late ?? null,
      };
    })
    .filter(Boolean);
}

export function AttendanceTodayTable({ lessons }) {
  if (lessons.length === 0) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Period</th><th>Lesson</th><th>Mark</th><th>Minutes late</th></tr></thead>
        <tbody>
          {lessons.map((lesson) => (
            <tr key={lesson.period_number}>
              <td>{lesson.period_name}</td>
              <td>
                {lesson.subject || <span style={{ color: '#97a0ad' }}>—</span>}
                {lesson.time && <span style={{ color: '#97a0ad', fontSize: '0.8em' }}> {lesson.time}</span>}
              </td>
              <td><AttendanceMark status={lesson.status} code={lesson.code} /></td>
              <td>{lesson.minutes_late ? `${lesson.minutes_late} min` : <span style={{ color: '#97a0ad' }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttendanceRecentTable({ marks, periodName }) {
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Date</th><th>Period</th><th>Mark</th><th>Minutes late</th></tr></thead>
        <tbody>
          {marks.map((a) => (
            <tr key={a.attendance_id}>
              <td>{formatUKDate(a.attend_date)}</td>
              <td>{periodName(a.period_number)}</td>
              <td><AttendanceMark status={a.status} code={a.code} /></td>
              <td>{a.minutes_late ? `${a.minutes_late} min` : <span style={{ color: '#97a0ad' }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
