'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { schoolToday } from '../../lib/schoolTime';

// Full-screen pop-up on a teacher's screen (migration 367): one of their
// lessons today started at least 10 minutes ago and its register hasn't been
// taken. The same look as the office's missed-lesson pop-up (309). The
// database decides whose lessons they are (my_register_reminders() reads the
// caller from auth.uid(); null for anyone without a staff record, and this
// stops asking). Saving the register clears it by itself; there is no "seen".
// Not shown on the register pages themselves, so it never covers a register
// being taken.

const POLL_MS = 60000;
const SNOOZE_MS = 5 * 60000;
const REGISTER_PAGES = ['/attendance', '/other-half/register'];

const reminderKey = (r) => (r.other_half_activity_id ? `oh-${r.other_half_activity_id}` : `slot-${r.slot_id}`);
const hhmm = (t) => String(t || '').slice(0, 5);

function registerLink(r) {
  const date = schoolToday();
  if (r.other_half_activity_id) return `/other-half/register?activityId=${r.other_half_activity_id}&date=${date}`;
  return `/attendance?classId=${r.class_id}&period=${r.period_number}&date=${date}`;
}

// A short two-tone beep. Browsers may block sound until someone has clicked
// on the page; then it is simply silent.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
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

export default function RegisterReminders() {
  const { session, profile } = useAuth();
  const pathname = usePathname();
  const [reminders, setReminders] = useState([]);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [snoozedKeys, setSnoozedKeys] = useState(() => new Set());
  const seenKeys = useRef(new Set());
  const [, setTick] = useState(0);

  const isStaff = !!session && !!profile && profile.role !== 'student' && profile.role !== 'parent';
  const onRegisterPage = REGISTER_PAGES.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  // Read inside the poll without restarting it on every navigation.
  const onRegisterPageRef = useRef(onRegisterPage);
  onRegisterPageRef.current = onRegisterPage;

  useEffect(() => {
    if (!isStaff) { setReminders([]); return undefined; }
    let cancelled = false;
    let timer = null;
    async function load() {
      const { data, error } = await supabase.rpc('my_register_reminders');
      if (cancelled) return;
      if (error) return; // try again next minute
      if (data == null) { clearInterval(timer); setReminders([]); return; } // no staff record
      const fresh = data.filter((r) => !seenKeys.current.has(reminderKey(r)));
      if (fresh.length > 0 && !onRegisterPageRef.current) beep();
      data.forEach((r) => seenKeys.current.add(reminderKey(r)));
      setReminders(data);
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

  // A snooze hides only the lessons that were showing; a new one shows at once.
  const snoozing = Date.now() < snoozedUntil;
  const visible = onRegisterPage ? [] : reminders.filter((r) => !(snoozing && snoozedKeys.has(reminderKey(r))));

  // Flash the tab title too, so a minimised window still shows it.
  useEffect(() => {
    if (visible.length === 0) return undefined;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `⚠ Register not taken` : original;
    }, 1000);
    return () => { clearInterval(t); document.title = original; };
  }, [visible.length]);

  if (visible.length === 0) return null;

  function snooze() {
    setSnoozedKeys(new Set(reminders.map(reminderKey)));
    setSnoozedUntil(Date.now() + SNOOZE_MS);
  }

  return (
    <div className="missed-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="register-reminder-title">
      <div className="missed-alert-box">
        <h2 id="register-reminder-title" style={{ marginTop: 0, color: '#b42318' }}>
          ⚠ {visible.length === 1 ? 'Your register has not been taken' : `${visible.length} of your registers have not been taken`}
        </h2>
        <p style={{ marginTop: 0 }}>
          The lesson started more than 10 minutes ago. Please take the register now, so the school knows where every student is.
        </p>
        {visible.map((r) => (
          <div key={reminderKey(r)} className="missed-alert-card">
            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              {r.lesson}
              {r.room ? <span style={{ fontWeight: 400, color: '#5b6472' }}> · room {r.room}</span> : null}
            </div>
            <div>
              {r.period_name}, started {hhmm(r.start_time)} ({r.minutes_since_start} min ago)
            </div>
            <div style={{ marginTop: '0.5rem' }}>
              <a
                href={registerLink(r)}
                style={{ display: 'inline-block', background: '#b42318', color: 'white', padding: '0.45rem 0.9rem', borderRadius: 6, fontWeight: 600, textDecoration: 'none' }}
              >
                Take register now
              </a>
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'right', marginTop: '0.75rem' }}>
          <button type="button" className="secondary" onClick={snooze}>Remind me in 5 minutes</button>
        </div>
      </div>
    </div>
  );
}
