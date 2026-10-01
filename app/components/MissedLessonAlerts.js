'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Full-screen pop-up on the school office's screens (migration 309): a
// student marked present earlier today has been marked absent, without a
// reason, in a lesson that started at least 15 minutes ago. Shown on every
// page for anyone whose role is granted /office/missed-lesson-alerts; the
// database decides that (office_missed_lesson_alerts() returns null for
// everyone else, and this stops asking). "Seen" clears it from every office
// screen; a corrected mark clears it by itself.

const POLL_MS = 60000;
const SNOOZE_MS = 2 * 60000;

const alertKey = (a) => `${a.student_id}-${a.period_number}`;
const studentName = (a) => `${a.first_name} ${a.last_name}${a.preferred_name && a.preferred_name !== a.first_name ? ` (${a.preferred_name})` : ''}`;

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

export default function MissedLessonAlerts() {
  const { session, profile } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [snoozedKeys, setSnoozedKeys] = useState(() => new Set());
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const seenKeys = useRef(new Set());
  const [, setTick] = useState(0);

  const isStaff = !!session && !!profile && profile.role !== 'student' && profile.role !== 'parent';

  useEffect(() => {
    if (!isStaff) { setAlerts([]); return undefined; }
    let cancelled = false;
    let timer = null;
    async function load() {
      const { data, error: e } = await supabase.rpc('office_missed_lesson_alerts');
      if (cancelled) return;
      if (e) return; // try again next minute
      if (data == null) { clearInterval(timer); setAlerts([]); return; } // not an office screen
      const fresh = data.filter((a) => !seenKeys.current.has(alertKey(a)));
      if (fresh.length > 0) beep();
      data.forEach((a) => seenKeys.current.add(alertKey(a)));
      setAlerts(data);
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

  // Flash the tab title too, so a minimised window still shows it.
  useEffect(() => {
    if (visible.length === 0) return undefined;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `⚠ ${visible.length} missing from lesson` : original;
    }, 1000);
    return () => { clearInterval(t); document.title = original; };
  }, [visible.length]);

  if (visible.length === 0) return null;

  async function acknowledge(a) {
    const key = alertKey(a);
    setBusy(key);
    setError(null);
    const { error: e } = await supabase.rpc('acknowledge_missed_lesson_alert', {
      p_student_id: a.student_id, p_period_number: a.period_number, p_note: notes[key] || null,
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
    <div className="missed-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="missed-alert-title">
      <div className="missed-alert-box">
        <h2 id="missed-alert-title" style={{ marginTop: 0, color: '#b42318' }}>
          ⚠ {visible.length === 1 ? 'A student is' : `${visible.length} students are`} missing from a lesson
        </h2>
        <p style={{ marginTop: 0 }}>
          Marked present earlier today, now marked absent with no reason, more than 15 minutes into the lesson.
        </p>
        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {visible.map((a) => {
          const key = alertKey(a);
          return (
            <div key={key} className="missed-alert-card">
              <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                <a href={`/students/${a.student_id}`}>{studentName(a)}</a>
                <span style={{ fontWeight: 400, color: '#5b6472' }}>
                  {' '}· Year {a.year_group}{a.form_class ? ` · ${a.form_class}` : ''}{a.boarding_house ? ` · ${a.boarding_house}` : ''}
                </span>
              </div>
              <div>
                Should be in <strong>{a.lesson || a.period_name}</strong>
                {a.teacher ? ` with ${a.teacher}` : ''}
                {a.room ? <>, room <strong>{a.room}</strong></> : ''}
                {' '}({a.period_name}, started {String(a.start_time).slice(0, 5)}, {a.minutes_since_start} min ago)
              </div>
              <div style={{ color: '#5b6472' }}>
                Last seen: {a.last_seen_period}
                {' '}· Marked absent{a.code ? ` (${a.code})` : ''}{a.marked_by ? ` by ${a.marked_by}` : ''}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Note (optional), e.g. sent someone to look"
                  value={notes[key] || ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                  style={{ flex: '1 1 14rem' }}
                />
                <button type="button" disabled={busy === key} onClick={() => acknowledge(a)}>
                  {busy === key ? 'Saving…' : 'Seen: dealing with it'}
                </button>
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
