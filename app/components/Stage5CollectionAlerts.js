'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Full-screen PURPLE pop-up on the school office's screens (migration 383):
// a teacher has just given a student a Stage 5 during their own lesson or
// Other Half activity, so someone must go and collect the student from it.
// Purple on purpose, so it is never mistaken for the red "missing from a
// lesson" pop-up (MissedLessonAlerts, 309), which asks the office to *find*
// a student. Shown on every page for anyone whose role is granted
// /office/stage5-collection-alerts; the database decides that
// (office_stage5_collection_alerts() returns null for everyone else, and
// this stops asking). "Going to collect" clears it from every office screen.
// A Stage 5 given during prep (migration 392) goes to the Head of Boarding
// instead (kind 'prep'), on the same purple pop-up, saying "from prep".

const POLL_MS = 30000;
const SNOOZE_MS = 2 * 60000;

const studentName = (a) => `${a.first_name} ${a.last_name}${a.preferred_name && a.preferred_name !== a.first_name ? ` (${a.preferred_name})` : ''}`;

// Three rising beeps: a different sound from the missed-lesson pop-up's two
// falling ones. Silent if the browser hasn't allowed sound yet.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523, 659, 784].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.2);
      o.stop(ctx.currentTime + i * 0.2 + 0.15);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* no sound available */ }
}

export default function Stage5CollectionAlerts() {
  const { session, profile } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [snoozedIds, setSnoozedIds] = useState(() => new Set());
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const seenIds = useRef(new Set());
  const [, setTick] = useState(0);

  const isStaff = !!session && !!profile && profile.role !== 'student' && profile.role !== 'parent';

  useEffect(() => {
    if (!isStaff) { setAlerts([]); return undefined; }
    let cancelled = false;
    let timer = null;
    async function load() {
      const { data, error: e } = await supabase.rpc('office_stage5_collection_alerts');
      if (cancelled) return;
      if (e) return; // try again next time
      if (data == null) { clearInterval(timer); setAlerts([]); return; } // not an office screen
      const fresh = data.filter((a) => !seenIds.current.has(a.id));
      if (fresh.length > 0) beep();
      data.forEach((a) => seenIds.current.add(a.id));
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
  const visible = alerts.filter((a) => !(snoozing && snoozedIds.has(a.id)));

  // Flash the tab title too, so a minimised window still shows it.
  useEffect(() => {
    if (visible.length === 0) return undefined;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `🟣 Stage 5: collect ${visible.length === 1 ? 'a student' : `${visible.length} students`}` : original;
    }, 1000);
    return () => { clearInterval(t); document.title = original; };
  }, [visible.length]);

  if (visible.length === 0) return null;

  const allPrep = visible.every((a) => a.kind === 'prep');
  const anyPrep = visible.some((a) => a.kind === 'prep');
  const from = allPrep ? 'prep' : anyPrep ? 'their lesson or prep' : 'their lesson';

  async function acknowledge(a) {
    setBusy(a.id);
    setError(null);
    const { error: e } = await supabase.rpc('acknowledge_stage5_collection', {
      p_alert_id: a.id, p_note: notes[a.id] || null,
    });
    setBusy(null);
    if (e) { setError(e.message); return; }
    setAlerts((list) => list.filter((x) => x.id !== a.id));
  }

  function snooze() {
    setSnoozedIds(new Set(alerts.map((a) => a.id)));
    setSnoozedUntil(Date.now() + SNOOZE_MS);
  }

  return (
    <div className="stage5-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="stage5-alert-title">
      <div className="stage5-alert-box">
        <div className="stage5-alert-band">STAGE 5 · COLLECT FROM {allPrep ? 'PREP' : anyPrep ? 'LESSON / PREP' : 'LESSON'}</div>
        <h2 id="stage5-alert-title" style={{ marginTop: '0.75rem', color: '#53389e' }}>
          Please go and collect {visible.length === 1 ? 'this student' : `these ${visible.length} students`} from {from}
        </h2>
        <p style={{ marginTop: 0 }}>
          {allPrep ? 'A Stage 5 has just been given during prep.' : 'The teacher has just given a Stage 5 during the lesson.'}
        </p>
        {error && <p style={{ color: '#b42318' }}>{error}</p>}
        {visible.map((a) => (
          <div key={a.id} className="stage5-alert-card">
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              <a href={`/students/${a.student_id}`}>{studentName(a)}</a>
              <span style={{ fontWeight: 400, color: '#5b6472' }}>
                {' '}· Year {a.year_group}{a.form_class ? ` · ${a.form_class}` : ''}{a.boarding_house ? ` · ${a.boarding_house}` : ''}
              </span>
            </div>
            <div style={{ fontSize: '1.05rem' }}>
              Collect from <strong>{a.kind === 'prep' ? 'prep' : a.lesson}</strong>
              {a.room ? <>, room <strong>{a.room}</strong></> : ''}
              {a.logged_by ? ` (${a.logged_by})` : ''}
              {a.period_name ? ` · ${a.period_name}` : ''}
            </div>
            <div style={{ color: '#5b6472' }}>
              {a.category || 'Stage 5'}{a.points != null ? ` (${a.points} pts)` : ''}
              {' '}· logged {a.minutes_ago <= 0 ? 'just now' : `${a.minutes_ago} min ago`}
            </div>
            {a.description && (
              <div style={{ marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>“{a.description}”</div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Note (optional), e.g. who is going"
                value={notes[a.id] || ''}
                onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                style={{ flex: '1 1 14rem' }}
              />
              <button type="button" className="stage5-alert-button" disabled={busy === a.id} onClick={() => acknowledge(a)}>
                {busy === a.id ? 'Saving…' : 'Going to collect'}
              </button>
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
          <button type="button" className="secondary" onClick={snooze}>Hide for 2 minutes</button>
        </div>
      </div>
    </div>
  );
}
