'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import { useAuth } from '../../../lib/AuthContext';
import { formatTimeRange } from '../../../lib/formatTime';
import { OH_DAY_NAMES, loadOtherHalfSlots, loadCurrentOtherHalfTermId, staffByActivity, staffNames } from '../../../lib/otherHalf';

// Students choose one activity per Other Half day. Every rule (choices open,
// only during Evening Prep as Bell Times sets it, their year, the activity
// not full) is enforced by choose_other_half_activity() in the database;
// this page just offers what those rules will accept. A day the school has
// placed the student in and locked (migration 302) can't be changed until the
// lock ends; the page says "Placed by the school", never why.
function StudentOtherHalfInner() {
  const { profile } = useAuth();
  const studentId = profile?.student_id;
  const [student, setStudent] = useState(null);
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState(null);
  const [windows, setWindows] = useState({});
  const [slots, setSlots] = useState({ days: [], byDay: {} });
  const [activities, setActivities] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [taken, setTaken] = useState({});
  const [mine, setMine] = useState({}); // day_of_week -> activity_id
  const [locks, setLocks] = useState({}); // day_of_week -> { until } for a lock in force
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [prepSlots, setPrepSlots] = useState([]); // Evening Prep rows from Bell Times
  const [inPrep, setInPrep] = useState(false);

  useEffect(() => {
    async function loadStatic() {
      if (!studentId) return;
      const [{ data: s }, { data: t }, { data: w }, sl, currentTerm] = await Promise.all([
        supabase.from('students').select('first_name, year_group').eq('student_id', studentId).single(),
        supabase.from('terms').select('*').order('start_date'),
        supabase.from('other_half_terms').select('*'),
        loadOtherHalfSlots(),
        loadCurrentOtherHalfTermId(),
      ]);
      setStudent(s || null);
      setSlots(sl);
      const windowByTerm = Object.fromEntries((w || []).map((r) => [r.term_id, r]));
      setWindows(windowByTerm);
      // This term, plus any later term whose choices are already open.
      const current = (t || []).find((x) => x.term_id === currentTerm);
      const relevant = (t || []).filter((x) => x.term_id === currentTerm
        || (current && x.start_date > current.start_date && windowByTerm[x.term_id]?.choices_open));
      setTerms(relevant);
      const openLater = relevant.find((x) => x.term_id !== currentTerm && isOpen(windowByTerm[x.term_id]));
      setTermId(isOpen(windowByTerm[currentTerm]) || !openLater ? currentTerm : openLater.term_id);
    }
    loadStatic();
  }, [studentId]);

  async function loadTerm() {
    if (!termId || !studentId) return;
    const [{ data: acts }, { data: counts }, { data: ch }] = await Promise.all([
      supabase.from('other_half_activities').select('*').eq('term_id', termId).eq('is_active', true).order('activity_name'),
      supabase.rpc('other_half_places_taken', { p_term_id: termId }),
      supabase.from('other_half_choices').select('activity_id, day_of_week, locked, locked_until').eq('student_id', studentId).eq('term_id', termId),
    ]);
    setActivities(acts || []);
    setTaken(Object.fromEntries((counts || []).map((c) => [c.activity_id, c.taken])));
    setMine(Object.fromEntries((ch || []).map((c) => [c.day_of_week, c.activity_id])));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    setLocks(Object.fromEntries((ch || [])
      .filter((c) => c.locked && (!c.locked_until || c.locked_until >= today))
      .map((c) => [c.day_of_week, { until: c.locked_until }])));
    const ids = (acts || []).map((a) => a.activity_id);
    if (ids.length) {
      const { data: st } = await supabase.from('other_half_activity_staff').select('activity_id, staff_id, staff(staff_id, first_name, last_name)').in('activity_id', ids);
      setStaffMap(staffByActivity(st));
    } else {
      setStaffMap({});
    }
  }

  useEffect(() => { loadTerm(); }, [termId, studentId]);

  // Choices can only change during Evening Prep; the database decides, and
  // this re-asks every half minute so the buttons open and close on time.
  useEffect(() => {
    supabase.from('school_day').select('day_of_week, start_time, end_time').eq('short_label', 'EP')
      .then(({ data }) => setPrepSlots(data || []));
    const check = () => supabase.rpc('in_evening_prep').then(({ data }) => setInPrep(!!data));
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, []);

  function isOpen(w) {
    return !!w?.choices_open && (!w.choices_close_at || new Date(w.choices_close_at) > new Date());
  }

  async function choose(a) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc('choose_other_half_activity', { p_activity_id: a.activity_id });
    setBusy(false);
    if (error) setStatus(error.message);
    else setStatus(`You're down for ${a.activity_name} on ${OH_DAY_NAMES[a.day_of_week]}s.`);
    loadTerm();
  }

  async function clearChoice(day) {
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.rpc('drop_other_half_choice', { p_term_id: termId, p_day_of_week: day });
    setBusy(false);
    if (error) setStatus(error.message);
    loadTerm();
  }

  if (!studentId) return <p>Your account isn&apos;t linked to a student record yet — ask the school office to link it.</p>;
  if (!student) return <p>Loading...</p>;

  const w = windows[termId];
  const open = isOpen(w);
  const canEdit = open && inPrep;
  // "19:00–20:00" if prep is the same every day, else day by day.
  const prepTimes = (() => {
    const ranges = [...new Set(prepSlots.map((p) => formatTimeRange(p.start_time, p.end_time)))];
    if (ranges.length === 1) return ranges[0];
    return Object.keys(OH_DAY_NAMES).map((d) => prepSlots.find((p) => p.day_of_week === d))
      .filter(Boolean).map((p) => `${p.day_of_week} ${formatTimeRange(p.start_time, p.end_time)}`).join(', ');
  })();
  const mineForYear = activities.filter((a) => a.year_groups.includes(student.year_group));
  const days = slots.days.filter((d) => mineForYear.some((a) => a.day_of_week === d) || mine[d]);

  return (
    <div>
      <p><a href="/">← Home</a></p>
      <h1>The Other Half</h1>
      <p style={{ marginTop: 0 }}>Pick one activity for each day. It goes into the Other Half slot on your timetable.</p>

      <div className="card">
        {terms.length > 1 && (
          <label style={{ marginRight: '1rem' }}>
            Term
            <select value={termId ?? ''} onChange={(e) => setTermId(Number(e.target.value))}>
              {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select>
          </label>
        )}
        {open ? (
          <div>
            <p style={{ margin: 0, color: '#1a7f37', fontWeight: 600 }}>
              Choices are open{w?.choices_close_at ? ` until ${new Date(w.choices_close_at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.
            </p>
            {inPrep ? (
              <p style={{ margin: '0.25rem 0 0' }}>It&apos;s Evening Prep — you can change your choices now.</p>
            ) : (
              <p style={{ margin: '0.25rem 0 0', color: '#b45309', fontWeight: 600 }}>
                You can only change your choices during Evening Prep{prepTimes ? ` (${prepTimes})` : ''}.
              </p>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, color: '#666' }}>Choices are closed — ask your Other Half coordinator if you need to change.</p>
        )}
      </div>

      {status && <p><strong>{status}</strong></p>}

      {days.length === 0 && <div className="card"><p>There are no activities for Year {student.year_group} yet.</p></div>}

      {days.map((d) => {
        const chosen = mine[d];
        const chosenActivity = activities.find((a) => a.activity_id === chosen);
        const slot = slots.byDay[d];
        const lock = locks[d];
        const canEditDay = canEdit && !lock;
        return (
          <div key={d} className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>
                {OH_DAY_NAMES[d]}
                {slot && <span style={{ fontWeight: 400, fontSize: '0.8em', color: '#666' }}> · {formatTimeRange(slot.start_time, slot.end_time)}</span>}
              </h2>
              <span>
                {chosenActivity ? <>Your choice: <strong>{chosenActivity.activity_name}</strong></> : <span style={{ color: '#b45309', fontWeight: 600 }}>Not chosen yet</span>}
                {chosen && canEditDay && <> <button type="button" className="secondary" disabled={busy} onClick={() => clearChoice(d)}>Clear</button></>}
              </span>
            </div>
            {lock && (
              <p style={{ margin: '0.5rem 0 0', fontWeight: 600, color: '#b45309' }}>
                Placed by the school{lock.until ? ` until ${new Date(`${lock.until}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}. You can&apos;t change this day{lock.until ? ' until then' : ' for now'}.
              </p>
            )}
            <div className="student-card-grid" style={{ marginTop: '0.75rem' }}>
              {mineForYear.filter((a) => a.day_of_week === d).map((a) => {
                const n = taken[a.activity_id] || 0;
                const isMine = chosen === a.activity_id;
                const full = a.capacity != null && n >= a.capacity && !isMine;
                return (
                  <div
                    key={a.activity_id}
                    className="card"
                    style={{
                      flexDirection: 'column', alignItems: 'stretch', margin: 0,
                      borderColor: isMine ? '#1a7f37' : undefined, borderWidth: isMine ? 2 : undefined,
                    }}
                  >
                    <strong>{a.activity_name}</strong>
                    {a.description && <span style={{ fontSize: '0.9em' }}>{a.description}</span>}
                    <span style={{ fontSize: '0.85em', color: '#666' }}>
                      {[a.room, staffNames(staffMap[a.activity_id])].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span style={{ fontSize: '0.85em', color: full ? '#b91c1c' : '#666' }}>
                      {a.capacity == null ? 'No limit' : full ? 'Full' : `${a.capacity - n} place${a.capacity - n === 1 ? '' : 's'} left`}
                    </span>
                    <div style={{ marginTop: '0.5rem' }}>
                      {isMine ? (
                        <span style={{ color: '#1a7f37', fontWeight: 600 }}>✓ Chosen</span>
                      ) : (
                        <button type="button" disabled={!canEditDay || full || busy} onClick={() => choose(a)}>
                          {chosen ? 'Switch to this' : 'Choose'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StudentOtherHalfPage() {
  return <RequireAuth><StudentOtherHalfInner /></RequireAuth>;
}
