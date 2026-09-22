'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';

// Shown to everyone while a backup freeze is on.
//
// Without this, backup mode looks like the system is broken: saves fail with a
// database error and staff have no idea why or how long for. The freeze itself
// is enforced in Postgres (migration 117) — this banner is purely the
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
    // Frequent enough that staff are not left staring at a stale banner, rare
    // enough to be invisible against normal page traffic.
    const timer = setInterval(check, 15000);
    return () => { cancelled = true; clearInterval(timer); };
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
