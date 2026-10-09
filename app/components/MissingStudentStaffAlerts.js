'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Pop-up on every member of staff's screen (migration 382) at the same moment
// the office gets its missed-lesson pop-up (309): "Do you know where this
// student is? If so, please send them to <lesson>." The database decides who
// sees it (staff_missing_student_alerts() returns null for non-staff and for
// the office, who have their own pop-up, and this stops asking) and leaves
// out the person who marked the student absent. It lasts until the period
// ends. "I've sent them" clears it from every screen and tells the office;
// "Not with me" clears it from this person's screen only. "They're with me"
// (migration 418) changes the absent mark to C with "With <their name>" in
// the mark's note, which clears it from every screen, the office's too.

const POLL_MS = 60000;
const SNOOZE_MS = 2 * 60000;

const alertKey = (a) => `${a.student_id}-${a.period_number}`;
const studentName = (a) => `${a.first_name} ${a.last_name}${a.preferred_name && a.preferred_name !== a.first_name ? ` (${a.preferred_name})` : ''}`;
const hhmm = (t) => String(t || '').slice(0, 5);

// A short two-tone beep. Browsers may block sound until someone has clicked
// on the page; then it is simply silent.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.2);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* no sound available */ }
}

export default function MissingStudentStaffAlerts() {
  const { session, profile } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [photos, setPhotos] = useState({});
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [snoozedKeys, setSnoozedKeys] = useState(() => new Set());
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const seenKeys = useRef(new Set());
  const photoIds = useRef(new Set());
  const [, setTick] = useState(0);

  const isStaff = !!session && !!profile && profile.role !== 'student' && profile.role !== 'parent';

  useEffect(() => {
    if (!isStaff) { setAlerts([]); return undefined; }
    let cancelled = false;
    let timer = null;
    async function load() {
      const { data, error: e } = await supabase.rpc('staff_missing_student_alerts');
      if (cancelled) return;
      if (e) return; // try again next minute
      if (data == null) { clearInterval(timer); setAlerts([]); return; } // office or not staff
      const fresh = data.filter((a) => !seenKeys.current.has(alertKey(a)));
      if (fresh.length > 0) beep();
      data.forEach((a) => seenKeys.current.add(alertKey(a)));
      setAlerts(data);
      // A photo helps someone who doesn't teach the student; fetch each once.
      const need = [...new Set(data.map((a) => a.student_id))].filter((id) => !photoIds.current.has(id));
      if (need.length > 0) {
        need.forEach((id) => photoIds.current.add(id));
        const { data: rows } = await supabase.from('students').select('student_id, photo_base64').in('student_id', need);
        if (!cancelled && rows) {
          setPhotos((p) => ({ ...p, ...Object.fromEntries(rows.filter((r) => r.photo_base64).map((r) => [r.student_id, r.photo_base64])) }));
        }
      }
    }
    load();
    timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isStaff]);

  // Re-render when a snooze runs out.
  useEffect(() => {
    if (!snoozedUntil) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, snoozedUntil - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [snoozedUntil]);

  // A snooze hides only the alerts that were showing; a new one shows at once.
  const snoozing = Date.now() < snoozedUntil;
  const visible = alerts.filter((a) => !(snoozing && snoozedKeys.has(alertKey(a))));

  if (visible.length === 0) return null;

  async function respond(a, response) {
    const key = alertKey(a);
    setBusy(key);
    setError(null);
    const { error: e } = await supabase.rpc('respond_missing_student_alert', {
      p_student_id: a.student_id, p_period_number: a.period_number, p_response: response,
      p_note: notes[key] || null,
    });
    setBusy(null);
    if (e) { setError(e.message); return; }
    setAlerts((list) => list.filter((x) => alertKey(x) !== key));
  }

  function snooze() {
    setSnoozedKeys(new Set(alerts.map(alertKey)));
    setSnoozedUntil(Date.now() + SNOOZE_MS);
  }

  return (
    <div className="missed-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="missing-student-title">
      <div className="missed-alert-box">
        <h2 id="missing-student-title" style={{ marginTop: 0, color: '#b42318' }}>
          ⚠ Do you know where {visible.length === 1 ? 'this student is' : 'these students are'}?
        </h2>
        <p style={{ marginTop: 0 }}>
          {visible.length === 1 ? 'This student was' : 'These students were'} in school earlier today but{' '}
          {visible.length === 1 ? 'is' : 'are'} missing from a lesson. If you know where they are, please send them
          to the lesson below.
        </p>
        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {visible.map((a) => {
          const key = alertKey(a);
          return (
            <div key={key} className="missed-alert-card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              {photos[a.student_id] && (
                <img
                  src={`data:image/jpeg;base64,${photos[a.student_id]}`}
                  alt=""
                  style={{ width: 72, height: 90, objectFit: 'cover', borderRadius: 6, flex: '0 0 auto' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                  {studentName(a)}
                  <span style={{ fontWeight: 400, color: '#5b6472' }}>
                    {' '}· Year {a.year_group}{a.form_class ? ` · ${a.form_class}` : ''}{a.boarding_house ? ` · ${a.boarding_house}` : ''}
                  </span>
                </div>
                <div style={{ fontSize: '1.05rem', marginTop: '0.25rem' }}>
                  Please send them to <strong>{a.lesson || a.period_name}</strong>
                  {a.room ? <>, room <strong>{a.room}</strong></> : ''}
                  {a.teacher ? ` (${a.teacher})` : ''}
                </div>
                <div style={{ color: '#5b6472' }}>
                  {a.period_name}, {hhmm(a.start_time)}–{hhmm(a.end_time)}, started {a.minutes_since_start} min ago
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Where were they? / why with you (optional)"
                    value={notes[key] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                    style={{ flex: '1 1 12rem' }}
                  />
                  <button type="button" disabled={busy === key} onClick={() => respond(a, 'sent')}>
                    {busy === key ? 'Saving…' : 'I’ve sent them'}
                  </button>
                  <button type="button" disabled={busy === key} onClick={() => respond(a, 'with_me')}
                    title="Marks them C on the register, with your name in the note">
                    They’re with me
                  </button>
                  <button type="button" className="secondary" disabled={busy === key} onClick={() => respond(a, 'not_with_me')}>
                    Not with me
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
          <button type="button" className="secondary" onClick={snooze}>Hide for 2 minutes</button>
        </div>
      </div>
    </div>
  );
}
