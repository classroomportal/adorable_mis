'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Planned absences (migration 318): one authorised code for a student over a
// run of whole days. Adding one fills in every period the student has on the
// past days and today at once; later days are filled in each morning. A mark
// already in a register is never overwritten, and once a teacher saves a
// register the mark is theirs. All the checks happen in the database
// (add_planned_absence() / end_planned_absence()); this page only asks.

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
  const [absences, setAbsences] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState({ name: '', year: '' });
  const [studentId, setStudentId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const [backOn, setBackOn] = useState({}); // absence id -> date typed
  const [rowStatus, setRowStatus] = useState({}); // absence id -> message

  useEffect(() => {
    async function loadOptions() {
      const [{ data: s }, { data: c }] = await Promise.all([
        supabase.from('students')
          .select('student_id, first_name, last_name, year_group, form_class')
          .eq('status', 'active')
          .order('last_name'),
        // Only authorised codes can be planned (the database refuses others).
        supabase.from('attendance_codes').select('code, description, status')
          .eq('status', 'authorized_absence')
          .order('description'),
      ]);
      setStudents(s || []);
      setCodes(c || []);
    }
    loadOptions();
  }, []);

  async function loadAbsences() {
    let q = supabase.from('planned_absences')
      .select('id, student_id, start_date, end_date, code, notes, created_at, cancelled_at, students(first_name, last_name, year_group, form_class), staff:created_by_staff_id(first_name, last_name), attendance_codes(description)')
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
    setSaving(true);
    setStatus('Saving...');
    const { data, error: e2 } = await supabase.rpc('add_planned_absence', {
      p_student_id: Number(studentId),
      p_start: startDate,
      p_end: endDate,
      p_code: code,
      p_notes: notes || null,
    });
    setSaving(false);
    if (e2) { setStatus(`Not saved: ${e2.message}`); return; }
    const added = data?.marks_added || 0;
    const later = endDate > today ? ' Later days will be filled in each morning.' : '';
    setStatus(`Saved for ${fullName(chosen)}. ${added} register mark${added === 1 ? '' : 's'} filled in so far.${later}`);
    setStudentId('');
    setFilter({ name: '', year: '' });
    setNotes('');
    loadAbsences();
  }

  async function endAbsence(a, cancel) {
    const day = cancel ? a.start_date : backOn[a.id];
    if (!day) { setRowStatus((m) => ({ ...m, [a.id]: 'Choose the day they are back.' })); return; }
    const who = fullName(a.students);
    const question = cancel
      ? `Cancel this planned absence for ${who}? The register marks it filled in will be removed, except any a teacher has since saved.`
      : `${who} is back on ${formatUKDate(day, { weekday: true })}? The marks it filled in from that day on will be removed, except any a teacher has since saved.`;
    if (!window.confirm(question)) return;
    const { data, error: e } = await supabase.rpc('end_planned_absence', { p_id: a.id, p_back_on: day });
    if (e) { setRowStatus((m) => ({ ...m, [a.id]: e.message })); return; }
    const removed = data?.marks_removed || 0;
    setRowStatus((m) => ({ ...m, [a.id]: `${data?.cancelled ? 'Cancelled' : 'Ended'}; ${removed} mark${removed === 1 ? '' : 's'} removed.` }));
    loadAbsences();
  }

  return (
    <div>
      <h1>Planned Absences</h1>
      <p>
        Give a student one attendance code for a run of days: illness, an appointment, an
        authorised holiday, an educational visit or an exclusion. Every lesson they have on those
        days (registration, Other Half and Evening Prep included) is filled in for the teacher.
        Past days and today are filled in straight away and later days each morning. A mark
        already in a register is never overwritten. Days outside term dates and holidays on the
        calendar are skipped.
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
            Last day
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
          <label>
            Code
            <select value={code} onChange={(e) => setCode(e.target.value)} required>
              <option value="">Choose...</option>
              {codes.map((c) => <option key={c.code} value={c.code}>{c.code}: {c.description}</option>)}
            </select>
          </label>
        </div>
        <label>
          Note (staff only, never shown to parents)
          <input type="text" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" disabled={saving} style={{ width: 'fit-content' }}>Save planned absence</button>
        {status && <p style={{ margin: 0 }}>{status}</p>}
      </form>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{showPast ? 'Planned absences (last 60 days and upcoming)' : 'Current and upcoming'}</h2>
          <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
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
                  return (
                    <tr key={a.id}>
                      <td>{fullName(a.students)}<br /><span style={{ color: '#666', fontSize: '0.85em' }}>Year {a.students?.year_group}{a.students?.form_class ? `, ${a.students.form_class}` : ''}</span></td>
                      <td>
                        {formatUKDate(a.start_date, { weekday: true })}
                        {a.end_date !== a.start_date && <> to {formatUKDate(a.end_date, { weekday: true })}</>}
                      </td>
                      <td>{a.code}: {a.attendance_codes?.description}</td>
                      <td>{a.notes || <span style={{ color: '#999' }}>—</span>}</td>
                      <td>{a.staff ? fullName(a.staff) : <span style={{ color: '#999' }}>—</span>}<br /><span style={{ color: '#666', fontSize: '0.85em' }}>{formatUKDate(a.created_at.slice(0, 10))}</span></td>
                      <td>
                        {!over && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {a.end_date > a.start_date && (
                              <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.85em' }}>Back on</span>
                                <input type="date" value={backOn[a.id] || ''} min={addDays(a.start_date, 1)} max={a.end_date}
                                  onChange={(e) => setBackOn((m) => ({ ...m, [a.id]: e.target.value }))} />
                                <button type="button" className="secondary" onClick={() => endAbsence(a, false)}>End early</button>
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
