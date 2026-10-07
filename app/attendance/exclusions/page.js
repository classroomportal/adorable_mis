'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';
import { canUseExclusionCode } from '../../../lib/exclusions';
import { schoolToday } from '../../../lib/schoolTime';
import { formatUKDate } from '../../../lib/formatDate';

// Exclusions (migration 396, the principal 7 Oct 2026). The principal and the
// college secretary record an internal exclusion (out of lessons, in school);
// only the principal records an exclusion from school (sent home). Either way
// every lesson in the time is marked X in the registers (marks already taken
// for those lessons included), and the reason goes to the parents by email and
// in their portal inbox. Nobody else can change an X mark. All of it is
// checked in record_exclusion() / end_exclusion(); this page only asks.
//
// Migration 401: the exclusion also goes on the behaviour log (0 points), and
// the person recording ticks which detentions not yet held it replaces
// (cancelled, their points kept). The half term's Friday detentions and
// exclusions are shown to help the decision, never to make it.

const fullName = (s) => (s ? `${s.first_name} ${s.last_name}` : '');
const MAX_MATCHES = 30;
const KIND_LABEL = { internal: 'Internal exclusion', external: 'Exclusion from school' };

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// What the student has had this half term, and the detentions the exclusion
// can replace. Information only: the school decides (the principal).
function HalfTermPanel({ context, cancelIds, setCancelIds }) {
  if (!context) return <p style={{ margin: 0 }}>Loading this half term's detentions...</p>;
  if (context.error) return <p style={{ margin: 0, color: '#b42318' }}>{context.error}</p>;
  const today = schoolToday();
  const thisHalf = (context.detentions || []).filter((d) => d.detention_date >= context.half_term_from && d.detention_date <= context.half_term_to);
  const cancellable = (context.detentions || []).filter((d) => d.can_cancel);
  const internal = context.internal_exclusions || [];
  const external = context.external_exclusions || [];
  const toggle = (id) => setCancelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <div style={{ border: '1px solid var(--line, #ddd)', borderRadius: '6px', padding: '0.75rem' }}>
      <strong>This half term</strong> ({formatUKDate(context.half_term_from)} to {formatUKDate(context.half_term_to)})
      <ul style={{ margin: '0.35rem 0', paddingLeft: '1.2rem' }}>
        <li>
          Friday detentions: <strong>{thisHalf.length}</strong>
          {thisHalf.length > 0 && ` (${thisHalf.map((d) => `${formatUKDate(d.detention_date)}${d.status === 'attended' ? ', held' : d.detention_date < today ? '' : ', to come'}`).join('; ')})`}
          {thisHalf.length >= 2 && ' · two or more: may be considered for internal exclusion'}
        </li>
        <li>
          Internal exclusions: <strong>{internal.length}</strong>
          {internal.length >= 2 && ' · a third may lead to exclusion from school (your decision)'}
        </li>
        {external.length > 0 && <li>Exclusions from school: <strong>{external.length}</strong></li>}
      </ul>
      {cancellable.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.9em' }}>No detentions still to be held.</p>
      ) : (
        <div>
          <p style={{ margin: '0.35rem 0 0.25rem', fontSize: '0.9em' }}>Tick the detentions this exclusion replaces. They are cancelled; their points stay on the log.</p>
          {cancellable.map((d) => (
            <label key={d.detention_id} style={{ display: 'flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'flex-start', fontWeight: 'normal' }}>
              <input type="checkbox" checked={cancelIds.includes(d.detention_id)} onChange={() => toggle(d.detention_id)} />
              <span>{formatUKDate(d.detention_date, { weekday: true })}: {d.reason}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ExclusionsInner() {
  const today = schoolToday();
  const { staffRoles } = useAuth();
  const allowed = canUseExclusionCode(staffRoles);
  const [students, setStudents] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [canExternal, setCanExternal] = useState(false);
  const [rows, setRows] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState(null);

  const [filter, setFilter] = useState({ name: '', year: '' });
  const [studentId, setStudentId] = useState('');
  const [kind, setKind] = useState('internal');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startPeriod, setStartPeriod] = useState('');
  const [endPeriod, setEndPeriod] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const [context, setContext] = useState(null);
  const [cancelIds, setCancelIds] = useState([]);

  const [backOn, setBackOn] = useState({});
  const [backPeriod, setBackPeriod] = useState({});
  const [rowStatus, setRowStatus] = useState({});

  useEffect(() => {
    async function loadOptions() {
      const [{ data: s }, { data: p }, { data: ext }] = await Promise.all([
        supabase.from('students')
          .select('student_id, first_name, last_name, year_group, form_class')
          .eq('status', 'active')
          .order('last_name'),
        supabase.from('periods').select('period_number, period_name').order('period_number'),
        // Only the principal (the database checks again).
        supabase.rpc('can_record_exclusion', { p_kind: 'external' }),
      ]);
      setStudents(s || []);
      setPeriods(p || []);
      setCanExternal(ext === true);
    }
    loadOptions();
  }, []);

  async function loadRows() {
    const { data, error: e } = await supabase.from('exclusions')
      .select('id, student_id, kind, start_date, end_date, start_period, end_period, reason, recorded_at, parents_emailed, parents_inboxed, ended_at, cancelled_at, students(first_name, last_name, year_group, form_class), staff:recorded_by_staff_id(first_name, last_name)')
      .is('cancelled_at', null)
      .gte('end_date', showPast ? addDays(today, -120) : today)
      .order('start_date', { ascending: false });
    if (e) { setError(e.message); return; }
    setError(null);
    setRows(data || []);
  }
  useEffect(() => { loadRows(); }, [showPast]);

  // The chosen student's half term: detentions and exclusions (401).
  useEffect(() => {
    setContext(null);
    setCancelIds([]);
    if (!studentId) return;
    supabase.rpc('exclusion_context', { p_student_id: Number(studentId) })
      .then(({ data, error: e }) => setContext(e ? { error: e.message } : data));
  }, [studentId]);

  const years = [...new Set(students.map((s) => s.year_group).filter(Boolean))].sort((a, b) => a - b);
  const name = filter.name.trim().toLowerCase();
  const matches = (name || filter.year)
    ? students.filter((s) => (!name || fullName(s).toLowerCase().includes(name))
        && (!filter.year || String(s.year_group) === filter.year)).slice(0, MAX_MATCHES)
    : [];
  const chosen = students.find((s) => String(s.student_id) === String(studentId));

  function periodName(n) {
    return periods.find((p) => p.period_number === Number(n))?.period_name || `Period ${n}`;
  }

  function describeDays(a) {
    const first = formatUKDate(a.start_date, { weekday: true });
    const last = formatUKDate(a.end_date, { weekday: true });
    if (a.start_date === a.end_date) {
      if (!a.start_period && !a.end_period) return first;
      return `${first}, ${a.start_period ? periodName(a.start_period) : 'start of day'} to ${a.end_period ? periodName(a.end_period) : 'end of day'}`;
    }
    return `${first}${a.start_period ? ` from ${periodName(a.start_period)}` : ''} to ${last}${a.end_period ? ` until ${periodName(a.end_period)}` : ''}`;
  }

  async function handleRecord(e) {
    e.preventDefault();
    if (!studentId) { setStatus('Choose a student.'); return; }
    if (!reason.trim()) { setStatus('Write the reason. It is sent to the parents.'); return; }
    if (!startDate || !endDate || endDate < startDate) { setStatus('The last day must be on or after the first day.'); return; }
    if (startDate === endDate && startPeriod && endPeriod && Number(endPeriod) < Number(startPeriod)) {
      setStatus('The last lesson must be the same as or after the first lesson.'); return;
    }
    const who = fullName(chosen);
    const detNote = cancelIds.length ? ` ${cancelIds.length} detention${cancelIds.length === 1 ? '' : 's'} will be cancelled (points kept).` : '';
    if (!window.confirm(`Record ${KIND_LABEL[kind].toLowerCase()} for ${who}? Their registers will be marked X, it goes on their behaviour log, and the reason is emailed to their parents now.${detNote}`)) return;
    setSaving(true);
    setStatus('Saving...');
    const { data, error: e2 } = await supabase.rpc('record_exclusion', {
      p_student_id: Number(studentId),
      p_kind: kind,
      p_start: startDate,
      p_end: endDate,
      p_reason: reason,
      p_start_period: startPeriod ? Number(startPeriod) : null,
      p_end_period: endPeriod ? Number(endPeriod) : null,
      p_cancel_detention_ids: cancelIds,
    });
    setSaving(false);
    if (e2) { setStatus(`Not saved: ${e2.message}`); return; }
    const marks = (data?.marks_added || 0) + (data?.marks_changed || 0);
    const later = endDate > today ? ' Later days are marked each morning.' : '';
    const told = data?.parent_emails_paused
      ? `Parent emails are paused, so parents were told in their portal inbox only (${data?.parents_inboxed || 0}).`
      : `${data?.parents_emailed || 0} parent email${data?.parents_emailed === 1 ? '' : 's'} sent, ${data?.parents_inboxed || 0} portal inbox notice${data?.parents_inboxed === 1 ? '' : 's'}.`;
    const dets = data?.detentions_cancelled || 0;
    const detText = dets ? ` ${dets} detention${dets === 1 ? '' : 's'} cancelled (points kept).` : '';
    setStatus(`Recorded for ${who} and added to their behaviour log. ${marks} register mark${marks === 1 ? '' : 's'} set to X so far.${later}${detText} ${told}`);
    setStudentId('');
    setFilter({ name: '', year: '' });
    setReason('');
    setStartPeriod('');
    setEndPeriod('');
    setKind('internal');
    loadRows();
  }

  async function endRow(a, cancel) {
    const day = cancel ? a.start_date : backOn[a.id];
    const period = cancel ? (a.start_period ?? null) : (backPeriod[a.id] ? Number(backPeriod[a.id]) : null);
    if (!day) { setRowStatus((m) => ({ ...m, [a.id]: 'Choose the day they are back.' })); return; }
    const who = fullName(a.students);
    const question = cancel
      ? `Cancel this exclusion for ${who}? Its X marks are removed and the parents are told it was cancelled.`
      : `${who} is back on ${formatUKDate(day, { weekday: true })}${period ? `, ${periodName(period)}` : ''}? The X marks from then on are removed and the parents are told it ended early.`;
    if (!window.confirm(question)) return;
    const { data, error: e } = await supabase.rpc('end_exclusion', { p_id: a.id, p_back_on: day, p_back_period: period });
    if (e) { setRowStatus((m) => ({ ...m, [a.id]: e.message })); return; }
    const removed = data?.marks_removed || 0;
    setRowStatus((m) => ({ ...m, [a.id]: `${data?.cancelled ? 'Cancelled' : 'Ended'}; ${removed} mark${removed === 1 ? '' : 's'} removed; parents told.` }));
    loadRows();
  }

  const periodOptions = (blank) => (
    <>
      <option value="">{blank}</option>
      {periods.map((p) => <option key={p.period_number} value={p.period_number}>{p.period_name}</option>)}
    </>
  );

  if (!allowed) {
    return (
      <div>
        <h1>Exclusions</h1>
        <p>Only the principal and the college secretary record exclusions.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Exclusions</h1>
      <p>
        Record an internal exclusion (out of lessons, in school) or, for the principal only, an
        exclusion from school. Every lesson in that time is marked <strong>X</strong> in the
        registers, including any already taken, and the reason is emailed to the parents and put in
        their portal inbox. It is added to the student's behaviour log (0 points), and you choose which
        of their detentions it replaces. Only the principal and the college secretary can change an X
        mark or an exclusion on the behaviour log.
      </p>

      <form onSubmit={handleRecord} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>Record an exclusion</h2>

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

        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'center' }}>
            <input type="radio" name="kind" value="internal" checked={kind === 'internal'} onChange={() => setKind('internal')} />
            Internal exclusion (out of lessons, in school)
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'center', color: canExternal ? undefined : '#999' }}
            title={canExternal ? undefined : 'Only the principal can record an exclusion from school.'}>
            <input type="radio" name="kind" value="external" checked={kind === 'external'} disabled={!canExternal} onChange={() => setKind('external')} />
            Exclusion from school (sent home){canExternal ? '' : ': the principal only'}
          </label>
        </fieldset>

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
        </div>
        {chosen && <HalfTermPanel context={context} cancelIds={cancelIds} setCancelIds={setCancelIds} />}

        <label style={{ flex: 'none' }}>
          Reason (sent to the parents as written)
          <textarea value={reason} rows={4} maxLength={2000} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button type="submit" disabled={saving || !chosen} style={{ width: 'fit-content' }}>Record exclusion and tell parents</button>
        {status && <p style={{ margin: 0 }}>{status}</p>}
      </form>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{showPast ? 'Exclusions (last 120 days and upcoming)' : 'Current and upcoming'}</h2>
          <label style={{ display: 'inline-flex', flexDirection: 'row', flex: 'none', gap: '0.4rem', alignItems: 'center' }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show recent past
          </label>
        </div>
        {error ? <p style={{ color: '#b42318' }}>{error}</p>
          : !rows ? <p>Loading...</p>
          : rows.length === 0 ? <p>None.</p> : (
            <div className="table-scroll"><table>
              <thead><tr><th>Student</th><th>Kind</th><th>Days</th><th>Reason</th><th>Recorded</th><th></th></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const over = a.end_date < today;
                  const mayChange = a.kind === 'internal' || canExternal;
                  return (
                    <tr key={a.id}>
                      <td>{fullName(a.students)}<br /><span style={{ color: '#666', fontSize: '0.85em' }}>Year {a.students?.year_group}{a.students?.form_class ? `, ${a.students.form_class}` : ''}</span></td>
                      <td>{KIND_LABEL[a.kind]}</td>
                      <td>{describeDays(a)}{a.ended_at && <><br /><span style={{ color: '#666', fontSize: '0.85em' }}>Ended early</span></>}</td>
                      <td style={{ whiteSpace: 'pre-wrap', maxWidth: '22rem' }}>{a.reason}</td>
                      <td>
                        {a.staff ? fullName(a.staff) : <span style={{ color: '#999' }}>—</span>}
                        <br /><span style={{ color: '#666', fontSize: '0.85em' }}>{formatUKDate(a.recorded_at.slice(0, 10))} · {a.parents_emailed} emailed, {a.parents_inboxed} inbox</span>
                      </td>
                      <td>
                        {!over && mayChange && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.85em' }}>Back on</span>
                              <input type="date" value={backOn[a.id] || ''} min={a.start_date} max={a.end_date}
                                onChange={(e) => setBackOn((m) => ({ ...m, [a.id]: e.target.value }))} />
                              <select value={backPeriod[a.id] || ''} aria-label="Back at lesson"
                                onChange={(e) => setBackPeriod((m) => ({ ...m, [a.id]: e.target.value }))}>
                                {periodOptions('Start of day')}
                              </select>
                              <button type="button" className="secondary" onClick={() => endRow(a, false)}>End early</button>
                            </span>
                            <button type="button" className="secondary" style={{ width: 'fit-content' }} onClick={() => endRow(a, true)}>Cancel</button>
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

export default function ExclusionsPage() {
  return (
    <RequireAuth><RequireResource resourceKey="/attendance/exclusions">
      <ExclusionsInner />
    </RequireResource></RequireAuth>
  );
}
