'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Student Marks (migration 390): the office changes one student's register
// marks lesson by lesson over a run of days, without opening each register.
// The lessons and marks come from office_student_lessons() and the changes go
// through office_set_student_marks(); both check the caller is the office
// (school office, attendance officer) in the database, log every change in
// Change History and refuse a mark in the future. This page only asks.

const fullName = (s) => (s ? `${s.first_name} ${s.last_name}` : '');
const MAX_MATCHES = 30;
const REMOVE = '__remove__';

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const keyOf = (r) => `${r.attend_date}|${r.period_number}`;

function StudentMarksInner() {
  const today = schoolToday();
  const [students, setStudents] = useState([]);
  const [codes, setCodes] = useState([]);
  const [filter, setFilter] = useState({ name: '', year: '' });
  const [studentId, setStudentId] = useState('');
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);

  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState({}); // key -> { code, minutes }
  const [ticked, setTicked] = useState({}); // key -> true
  const [bulkCode, setBulkCode] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      const [{ data: s }, { data: c }] = await Promise.all([
        supabase.from('students')
          .select('student_id, first_name, last_name, year_group, form_class')
          .eq('status', 'active')
          .order('last_name'),
        supabase.from('attendance_codes').select('code, description, status').order('code'),
      ]);
      setStudents(s || []);
      setCodes(c || []);
    }
    loadOptions();
  }, []);

  const years = [...new Set(students.map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b);
  const name = filter.name.trim().toLowerCase();
  const matches = (name || filter.year)
    ? students.filter((s) => (!name || fullName(s).toLowerCase().includes(name))
        && (!filter.year || String(s.year_group) === filter.year)).slice(0, MAX_MATCHES)
    : [];
  const chosen = students.find((s) => String(s.student_id) === String(studentId));
  const codeStatus = (code) => codes.find((c) => c.code === code)?.status;

  async function loadLessons(keepStatus = false) {
    if (!studentId) { setStatus('Choose a student.'); return; }
    if (!fromDate || !toDate || toDate < fromDate) { setStatus('The last day must be on or after the first day.'); return; }
    setLoading(true);
    if (!keepStatus) setStatus(null);
    const { data, error } = await supabase.rpc('office_student_lessons', {
      p_student_id: Number(studentId), p_from: fromDate, p_to: toDate,
    });
    setLoading(false);
    if (error) { setStatus(error.message); setRows(null); return; }
    setRows(data || []);
    setChanges({});
    setTicked({});
  }

  function setChange(r, patch) {
    const k = keyOf(r);
    setChanges((m) => {
      const next = { ...m, [k]: { ...(m[k] || {}), ...patch } };
      if (!next[k].code) delete next[k];
      return next;
    });
  }

  function applyToTicked() {
    if (!bulkCode) { setStatus('Choose a code to give the ticked lessons.'); return; }
    const keys = Object.keys(ticked).filter((k) => ticked[k]);
    if (keys.length === 0) { setStatus('Tick the lessons to change first.'); return; }
    setChanges((m) => {
      const next = { ...m };
      keys.forEach((k) => { next[k] = { code: bulkCode, minutes: m[k]?.minutes || '' }; });
      return next;
    });
    setStatus(null);
  }

  // Only real changes are sent: a new code, or new minutes on a late mark.
  function pendingMarks() {
    return (rows || []).flatMap((r) => {
      const ch = changes[keyOf(r)];
      if (!ch?.code) return [];
      if (ch.code === REMOVE) return r.code ? [{ date: r.attend_date, period: r.period_number, code: '' }] : [];
      const late = codeStatus(ch.code) === 'late';
      const minutes = late && ch.minutes !== '' && ch.minutes !== undefined ? String(Math.round(Number(ch.minutes))) : '';
      if (ch.code === r.code && (!late || minutes === String(r.minutes_late ?? ''))) return [];
      return [{ date: r.attend_date, period: r.period_number, code: ch.code, minutes_late: minutes }];
    });
  }

  async function save() {
    const marks = pendingMarks();
    if (marks.length === 0) { setStatus('Nothing has been changed.'); return; }
    const removing = marks.filter((m) => !m.code).length;
    const question = `Save ${marks.length} change${marks.length === 1 ? '' : 's'} to ${fullName(chosen)}'s marks?`
      + (removing ? ` ${removing} mark${removing === 1 ? '' : 's'} will be removed.` : '');
    if (!window.confirm(question)) return;
    setSaving(true);
    setStatus('Saving...');
    const { data, error } = await supabase.rpc('office_set_student_marks', {
      p_student_id: Number(studentId), p_marks: marks,
    });
    setSaving(false);
    if (error) { setStatus(`Not saved: ${error.message}`); return; }
    const set = data?.marks_set || 0;
    const removed = data?.marks_removed || 0;
    setStatus(`Saved: ${set} mark${set === 1 ? '' : 's'} set${removed ? `, ${removed} removed` : ''}.`);
    loadLessons(true);
  }

  const days = rows ? [...new Set(rows.map((r) => r.attend_date))] : [];
  const pendingCount = rows ? pendingMarks().length : 0;
  const allTicked = rows && rows.length > 0 && rows.every((r) => ticked[keyOf(r)]);

  const codeOptions = (blank) => (
    <>
      <option value="">{blank}</option>
      {codes.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
    </>
  );

  return (
    <div>
      <h1>Student Marks</h1>
      <p>
        Change one student&apos;s register marks lesson by lesson over a run of days, without opening
        each register: for example a student who was at an appointment for two lessons on Tuesday
        and in sick bay for one on Thursday. Every lesson on their timetable is listed (registration,
        Other Half and Evening Prep included), with the mark it has and who gave it. Only the school
        office and the attendance officer can do this. Each change is recorded in Change History,
        and a changed mark shows you as the person who gave it. A planned-absence mark you change
        here becomes an ordinary mark.
      </p>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
        {chosen ? (
          <p style={{ margin: 0 }}>
            Student: <strong>{fullName(chosen)}</strong> (Year {chosen.year_group}{chosen.form_class ? `, ${chosen.form_class}` : ''}){' '}
            <button type="button" className="secondary" onClick={() => { setStudentId(''); setRows(null); setChanges({}); setTicked({}); }}>Change</button>
          </p>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label>
                Find a student
                <input type="text" value={filter.name} placeholder="Name" onChange={(e) => setFilter((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label>
                Year
                <select value={filter.year} onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value }))}>
                  <option value="">Any</option>
                  {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
                </select>
              </label>
            </div>
            {matches.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                {matches.map((s) => (
                  <button key={s.student_id} type="button" className="secondary" onClick={() => { setStudentId(String(s.student_id)); setRows(null); }}>
                    {fullName(s)} · Y{s.year_group}{s.form_class ? ` ${s.form_class}` : ''}
                  </button>
                ))}
              </div>
            )}
            {(name || filter.year) && matches.length === 0 && <p style={{ color: '#666', margin: '0.5rem 0 0' }}>No student on roll matches.</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            First day
            <input type="date" value={fromDate} max={today} onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} />
          </label>
          <label>
            Last day
            <input type="date" value={toDate} min={fromDate} max={today} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <button type="button" style={{ width: 'fit-content' }} disabled={!studentId || loading} onClick={() => loadLessons()}>
            {loading ? 'Loading...' : 'Show lessons'}
          </button>
        </div>
        <p style={{ margin: 0, color: '#666', fontSize: '0.9em' }}>Up to 62 days at a time. Days outside term and holidays on the calendar aren&apos;t listed.</p>
        {status && !rows && <p style={{ margin: 0 }}>{status}</p>}
      </div>

      {rows && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={!!allTicked}
                onChange={(e) => setTicked(e.target.checked ? Object.fromEntries(rows.map((r) => [keyOf(r), true])) : {})} />
              Tick all
            </label>
            <select value={bulkCode} aria-label="Code for ticked lessons" onChange={(e) => setBulkCode(e.target.value)}>
              {codeOptions('Code for ticked lessons...')}
            </select>
            <button type="button" className="secondary" onClick={applyToTicked}>Give ticked lessons this code</button>
          </div>

          {rows.length === 0 ? <p>No lessons or marks for {fullName(chosen)} on these days.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th></th><th>Lesson</th><th>Mark now</th><th>Change to</th></tr></thead>
              <tbody>
                {days.map((d) => (
                  [
                    <tr key={d}><th colSpan={4} style={{ textAlign: 'left', background: '#f3f4f6' }}>{formatUKDate(d, { weekday: true })}</th></tr>,
                    ...rows.filter((r) => r.attend_date === d).map((r) => {
                      const k = keyOf(r);
                      const ch = changes[k];
                      const late = ch?.code && codeStatus(ch.code) === 'late';
                      return (
                        <tr key={k} style={ch?.code ? { background: '#fffbeb' } : undefined}>
                          <td>
                            <input type="checkbox" aria-label={`Tick ${r.period_name}`} checked={!!ticked[k]}
                              onChange={(e) => setTicked((m) => ({ ...m, [k]: e.target.checked }))} />
                          </td>
                          <td>
                            <strong>{r.period_name}</strong>{' '}
                            {r.lesson || <span style={{ color: '#999' }}>—</span>}
                            {r.teacher && <><br /><span style={{ color: '#666', fontSize: '0.85em' }}>{r.teacher}</span></>}
                            {!r.on_timetable && <><br /><span style={{ color: '#666', fontSize: '0.85em' }}>Not on their timetable now</span></>}
                          </td>
                          <td>
                            {r.code
                              ? <>{r.code}: {codes.find((c) => c.code === r.code)?.description || r.status}{r.minutes_late ? ` (${r.minutes_late} min)` : ''}</>
                              : <span style={{ color: '#999' }}>No mark</span>}
                            {(r.marked_by || r.planned) && (
                              <><br /><span style={{ color: '#666', fontSize: '0.85em' }}>
                                {r.planned ? 'Planned absence' : ''}{r.planned && r.marked_by ? ' · ' : ''}{r.marked_by || ''}
                              </span></>
                            )}
                          </td>
                          <td>
                            <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <select value={ch?.code || ''} aria-label={`New mark for ${r.period_name}`}
                                onChange={(e) => setChange(r, { code: e.target.value })}>
                                <option value="">No change</option>
                                {codes.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
                                {r.code && <option value={REMOVE}>Remove the mark</option>}
                              </select>
                              {late && (
                                <input type="number" min={0} max={600} placeholder="Minutes" aria-label="Minutes late" style={{ width: '6rem' }}
                                  value={ch.minutes ?? ''} onChange={(e) => setChange(r, { minutes: e.target.value })} />
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    }),
                  ]
                ))}
              </tbody>
            </table></div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={saving || pendingCount === 0} onClick={save}>
              Save {pendingCount || ''} change{pendingCount === 1 ? '' : 's'}
            </button>
            {pendingCount > 0 && <button type="button" className="secondary" onClick={() => setChanges({})}>Undo changes</button>}
            {status && <span>{status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudentMarksPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/attendance/student-marks">
      <StudentMarksInner />
    </RequireResource></RequireAuth>
  );
}
