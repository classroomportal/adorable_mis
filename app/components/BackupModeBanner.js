'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Shown to everyone while a backup freeze is on.
//
// Without this, backup mode looks like the system is broken: saves fail with a
// database error and staff have no idea why or how long for. The freeze itself
// is enforced in Postgres (migration 174) — this banner is purely the
// explanation, so it does not matter that a stale tab might miss it.
export default function BackupModeBanner() {
  const { session } = useAuth();
  const [mode, setMode] = useState(null);

  useEffect(() => {
    if (!session) { setMode(null); return undefined; }

    let cancelled = false;
    async function check() {
      const { data } = await supabase
        .from('system_backup_mode')
        .select('active, expires_at, reason')
        .maybeSingle();
      if (cancelled) return;
      // Expiry is evaluated here as well as in the database, so the banner
      // disappears on its own rather than lingering after the freeze lifts.
      const live = data?.active && data.expires_at && new Date(data.expires_at) > new Date();
      setMode(live ? data : null);
    }

    check();
    // Once a minute, and only while the tab is on screen, plus straight away
    // when it comes back. Every 15 s on every open tab, hidden or not, was
    // 441,000 requests and part of the 08:00 overload on 2 Oct 2026.
    const timer = setInterval(() => { if (!document.hidden) check(); }, 60000);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session]);

  if (!mode) return null;

  return (
    <div
      role="status"
      style={{
        background: '#fff4e5',
        borderBottom: '2px solid #f59e0b',
        color: '#7a3e00',
        padding: '0.75rem 1.5rem',
        fontSize: '0.95rem',
      }}
    >
      <strong>Backup in progress — saving is paused.</strong>{' '}
      You can still look things up, but changes won&apos;t save for a few minutes.
      {mode.reason ? <> Reason: {mode.reason}.</> : null}
    </div>
  );
}
