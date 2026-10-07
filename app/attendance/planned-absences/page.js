'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Planned absences (migrations 318 and 389): one authorised code for a
// student over a run of days, optionally from a lesson on the first day to a
// lesson on the last. Adding one fills in every period the student has on the
// past days and today at once; later days are filled in each morning. A mark
// already in a register is never overwritten. The marks stay the absence's:
// teachers can't change them, and only the office (school office, attendance
// officer) can change an absence's code. All the checks happen in the
// database (plan_absence() / end_planned_absence_from() /
// change_planned_absence_code()); this page only asks. Exclusions (X) are
// recorded and changed only by the principal and the college secretary, at
// /attendance/exclusions (migration 396), so X isn't offered here and X
// absences are shown without their buttons.

const fullName = (s) => (s ? `${s.first_name} ${s.last_name}` : '');
const MAX_MATCHES = 30;

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function PlannedAbsencesInner() {
  const today = schoolToday();
  const [students, setStudents] = useState([]);
  const [codes, setCodes] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [isOffice, setIsOffice] = useState(false);
  const [absences, setAbsences] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState({ name: '', year: '' });
  const [studentId, setStudentId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startPeriod, setStartPeriod] = useState(''); // '' = the whole first day
  const [endPeriod, setEndPeriod] = useState(''); // '' = the whole last day
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const [backOn, setBackOn] = useState({}); // absence id -> date typed
  const [backPeriod, setBackPeriod] = useState({}); // absence id -> period they are back at ('' = start of the day)
  const [newCode, setNewCode] = useState({}); // absence id -> code chosen (office only)
  const [rowStatus, setRowStatus] = useState({}); // absence id -> message

  useEffect(() => {
    async function loadOptions() {
      const [{ data: s }, { data: c }, { data: p }, { data: office }] = await Promise.all([
        supabase.from('students')
          .select('student_id, first_name, last_name, year_group, form_class')
          .eq('status', 'active')
          .order('last_name'),
        // Only authorised codes can be planned (the database refuses others),
        // and not X, which only Exclusions records (396).
        supabase.from('attendance_codes').select('code, description, status')
          .eq('status', 'authorized_absence')
          .neq('code', 'X')
          .order('description'),
        supabase.from('periods').select('period_number, period_name').order('period_number'),
        // Only shows or hides Change code; the database checks it again.
        supabase.rpc('is_attendance_office'),
      ]);
      setStudents(s || []);
      setCodes(c || []);
      setPeriods(p || []);
      setIsOffice(office === true);
    }
    loadOptions();
  }, []);

  async function loadAbsences() {
    let q = supabase.from('planned_absences')
      .select('id, student_id, start_date, end_date, start_period, end_period, code, notes, created_at, cancelled_at, students(first_name, last_name, year_group, form_class), staff:created_by_staff_id(first_name, last_name), attendance_codes(description)')
      .is('cancelled_at', null)
      .order('start_date', { ascending: false });
    // Current and upcoming by default; the last 60 days as well on request.
    q = q.gte('end_date', showPast ? addDays(today, -60) : today);
    const { data, error: e } = await q;
    if (e) { setError(e.message); return; }
    setError(null);
    setAbsences(data || []);
  }
  useEffect(() => { loadAbsences(); }, [showPast]);

  const years = [...new Set(students.map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b);
  const name = filter.name.trim().toLowerCase();
  const matches = (name || filter.year)
    ? students.filter((s) => (!name || fullName(s).toLowerCase().includes(name))
        && (!filter.year || String(s.year_group) === filter.year)).slice(0, MAX_MATCHES)
    : [];
  const chosen = students.find((s) => String(s.student_id) === String(studentId));

  async function handleAdd(e) {
    e.preventDefault();
    if (!studentId) { setStatus('Choose a student.'); return; }
    if (!code) { setStatus('Choose a code.'); return; }
    if (!startDate || !endDate || endDate < startDate) { setStatus('The last day must be on or after the first day.'); return; }
    if (startDate === endDate && startPeriod && endPeriod && Number(endPeriod) < Number(startPeriod)) {
      setStatus('The last lesson must be the same as or after the first lesson.'); return;
    }
    setSaving(true);
    setStatus('Saving...');
    const { data, error: e2 } = await supabase.rpc('plan_absence', {
      p_student_id: Number(studentId),
      p_start: startDate,
      p_end: endDate,
      p_code: code,
      p_notes: notes || null,
      p_start_period: startPeriod ? Number(startPeriod) : null,
      p_end_period: endPeriod ? Number(endPeriod) : null,
    });
    setSaving(false);
    if (e2) { setStatus(`Not saved: ${e2.message}`); return; }
    const added = data?.marks_added || 0;
    const later = endDate > today ? ' Later days will be filled in each morning.' : '';
    setStatus(`Saved for ${fullName(chosen)}. ${added} register mark${added === 1 ? '' : 's'} filled in so far.${later}`);
    setStudentId('');
    setFilter({ name: '', year: '' });
    setNotes('');
    setStartPeriod('');
    setEndPeriod('');
    loadAbsences();
  }

  async function endAbsence(a, cancel) {
    const day = cancel ? a.start_date : backOn[a.id];
    const period = cancel ? null : (backPeriod[a.id] ? Number(backPeriod[a.id]) : null);
    if (!day) { setRowStatus((m) => ({ ...m, [a.id]: 'Choose the day they are back.' })); return; }
    const who = fullName(a.students);
    const when = `${formatUKDate(day, { weekday: true })}${period ? `, ${periodName(period)}` : ''}`;
    const question = cancel
      ? `Cancel this planned absence for ${who}? The register marks it filled in will be removed, except any the office has since changed.`
      : `${who} is back on ${when}? The marks it filled in from then on will be removed, except any the office has since changed.`;
    if (!window.confirm(question)) return;
    const { data, error: e } = cancel
      ? await supabase.rpc('end_planned_absence_from', { p_id: a.id, p_back_on: day, p_back_period: a.start_period ?? null })
      : await supabase.rpc('end_planned_absence_from', { p_id: a.id, p_back_on: day, p_back_period: period });
    if (e) { setRowStatus((m) => ({ ...m, [a.id]: e.message })); return; }
    const removed = data?.marks_removed || 0;
    setRowStatus((m) => ({ ...m, [a.id]: `${data?.cancelled ? 'Cancelled' : 'Ended'}; ${removed} mark${removed === 1 ? '' : 's'} removed.` }));
    loadAbsences();
  }

  async function changeCode(a) {
    const chosenCode = newCode[a.id];
    if (!chosenCode || chosenCode === a.code) { setRowStatus((m) => ({ ...m, [a.id]: 'Choose a different code.' })); return; }
    if (!window.confirm(`Change ${fullName(a.students)}'s planned absence from ${a.code} to ${chosenCode}? Every register mark it filled in changes too.`)) return;
    const { data, error: e } = await supabase.rpc('change_planned_absence_code', { p_id: a.id, p_code: chosenCode });
    if (e) { setRowStatus((m) => ({ ...m, [a.id]: e.message })); return; }
    const n = data?.marks_changed || 0;
    setRowStatus((m) => ({ ...m, [a.id]: `Code changed to ${chosenCode}; ${n} mark${n === 1 ? '' : 's'} changed.` }));
    setNewCode((m) => ({ ...m, [a.id]: '' }));
    loadAbsences();
  }

  function periodName(n) {
    return periods.find((p) => p.period_number === Number(n))?.period_name || `Period ${n}`;
  }

  // "Mon 6 Oct 2026, Period 3 to Period 5" / "Mon 6 Oct 2026 from Period 4 to Wed 8 Oct 2026 until Period 1"
  function describeDays(a) {
    const first = formatUKDate(a.start_date, { weekday: true });
    const last = formatUKDate(a.end_date, { weekday: true });
    if (a.start_date === a.end_date) {
      if (!a.start_period && !a.end_period) return first;
      return `${first}, ${a.start_period ? periodName(a.start_period) : 'start of day'} to ${a.end_period ? periodName(a.end_period) : 'end of day'}`;
    }
    return `${first}${a.start_period ? ` from ${periodName(a.start_period)}` : ''} to ${last}${a.end_period ? ` until ${periodName(a.end_period)}` : ''}`;
  }

  const periodOptions = (blank) => (
    <>
      <option value="">{blank}</option>
      {periods.map((p) => <option key={p.period_number} value={p.period_number}>{p.period_name}</option>)}
    </>
  );

  return (
    <div>
      <h1>Planned Absences</h1>
      <p>
        Give a student one attendance code for a run of days, or from one lesson to another:
        illness, an appointment, an authorised holiday or an educational visit. Every
        lesson they have in that time (registration, Other Half and Evening Prep included) is
        filled in for the teacher. Past days and today are filled in straight away and later days
        each morning. A mark already in a register is never overwritten. Days outside term dates
        and holidays on the calendar are skipped. Teachers can't change these marks; only the
        school office and the attendance officer can, and only they can change an absence's code.
        Exclusions (X) are recorded only by the principal and the college secretary, on Exclusions,
        and only they can change them.
      </p>

      <form onSubmit={handleAdd} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Add a planned absence</h2>

        {chosen ? (
          <p style={{ margin: 0 }}>
            Student: <strong>{fullName(chosen)}</strong> (Year {chosen.year_group}{chosen.form_class ? `, ${chosen.form_class}` : ''}){' '}
            <button type="button" className="secondary" onClick={() => setStudentId('')}>Change</button>
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
                  <button key={s.student_id} type="button" className="secondary" onClick={() => setStudentId(String(s.student_id))}>
                    {fullName(s)} · Y{s.year_group}{s.form_class ? ` ${s.form_class}` : ''}
                  </button>
                ))}
              </div>
            )}
            {(name || filter.year) && matches.length === 0 && <p style={{ color: '#666', margin: '0.5rem 0 0' }}>No student on roll matches.</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label>
            First day
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} required />
          </label>
          <label>
            From lesson
            <select value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)}>
              {periodOptions('Whole day')}
            </select>
          </label>
          <label>
            Last day
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
          <label>
            To lesson
            <select value={endPeriod} onChange={(e) => setEndPeriod(e.target.value)}>
              {periodOptions('Whole day')}
            </select>
          </label>
          <label>
            Code
            <select value={code} onChange={(e) => setCode(e.target.value)} required>
              <option value="">Choose...</option>
              {codes.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
            </select>
          </label>
        </div>
        {/* Labels grow to a 140px basis (globals.css); in this column form that left a gap. */}
        <label style={{ flex: 'none' }}>
          Note (staff only, never shown to parents)
          <input type="text" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={saving} style={{ width: 'fit-content' }}>Save planned absence</button>
        {status && <p style={{ margin: 0 }}>{status}</p>}
      </form>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{showPast ? 'Planned absences (last 60 days and upcoming)' : 'Current and upcoming'}</h2>
          <label style={{ display: 'inline-flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show recent past
          </label>
        </div>
        {error ? <p style={{ color: '#b42318' }}>{error}</p>
          : !absences ? <p>Loading...</p>
          : absences.length === 0 ? <p>None.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Days</th><th>Code</th><th>Note</th><th>Added by</th><th></th></tr></thead>
              <tbody>
                {absences.map((a) => {
                  const over = a.end_date < today;
                  const exclusion = a.code === 'X';
                  return (
                    <tr key={a.id}>
                      <td>{fullName(a.students)}<br /><span style={{ color: '#666', fontSize: '0.85em' }}>Year {a.students?.year_group}{a.students?.form_class ? `, ${a.students.form_class}` : ''}</span></td>
                      <td>{describeDays(a)}</td>
                      <td>{a.code}: {a.attendance_codes?.description}</td>
                      <td>{a.notes || <span style={{ color: '#999' }}>—</span>}</td>
                      <td>{a.staff ? fullName(a.staff) : <span style={{ color: '#999' }}>—</span>}<br /><span style={{ color: '#666', fontSize: '0.85em' }}>{formatUKDate(a.created_at.slice(0, 10))}</span></td>
                      <td>
                        {!over && exclusion && (
                          <span style={{ color: '#666', fontSize: '0.85em' }}>An exclusion: only the principal or the college secretary can change it, on Exclusions.</span>
                        )}
                        {!over && !exclusion && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.85em' }}>Back on</span>
                              <input type="date" value={backOn[a.id] || ''} min={a.start_date} max={a.end_date}
                                onChange={(e) => setBackOn((m) => ({ ...m, [a.id]: e.target.value }))} />
                              <select value={backPeriod[a.id] || ''} aria-label="Back at lesson"
                                onChange={(e) => setBackPeriod((m) => ({ ...m, [a.id]: e.target.value }))}>
                                {periodOptions('Start of day')}
                              </select>
                              <button type="button" className="secondary" onClick={() => endAbsence(a, false)}>End early</button>
                            </span>
                            {isOffice && (
                              <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select value={newCode[a.id] || ''} aria-label="New code"
                                  onChange={(e) => setNewCode((m) => ({ ...m, [a.id]: e.target.value }))}>
                                  <option value="">New code...</option>
                                  {codes.filter((c) => c.code !== a.code).map((c) => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
                                </select>
                                <button type="button" className="secondary" onClick={() => changeCode(a)}>Change code</button>
                              </span>
                            )}
                            <button type="button" className="secondary" style={{ width: 'fit-content' }} onClick={() => endAbsence(a, true)}>Cancel</button>
                          </div>
                        )}
                        {rowStatus[a.id] && <p style={{ margin: '0.35rem 0 0', fontSize: '0.85em' }}>{rowStatus[a.id]}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
      </div>
    </div>
  );
}

export default function PlannedAbsencesPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/attendance/planned-absences">
      <PlannedAbsencesInner />
    </RequireResource></RequireAuth>
  );
}
