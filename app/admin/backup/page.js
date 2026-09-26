'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';

// Run a Backup — the admin tile described in docs/BACKUP_POLICY.md.
//
// Three steps, in order, with the freeze bracketing the dump so the resulting
// backup is a restore point nobody wrote to:
//
//   1. start_backup_mode()  — Postgres stops writes from everyone else
//   2. POST /api/backup     — triggers the same GitHub Actions workflow that
//                             runs nightly, then we poll it
//   3. end_backup_mode()    — thaw
//
// Step 3 runs even when step 2 fails. It is also not the only thing standing
// between the school and a stuck freeze: the freeze carries its own expiry in
// the database, so closing this tab mid-run costs a few minutes of read-only,
// not a day of lost data entry.

const FREEZE_MINUTES = 15;
const POLL_MS = 5000;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatWhen(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function BackupInner() {
  const [mode, setMode] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [runUrl, setRunUrl] = useState(null);
  // null while unknown; false means the server has no GitHub token, so
  // starting a backup would only freeze the school and then fail.
  const [canRun, setCanRun] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const load = useCallback(async () => {
    const [{ data: modeRow }, { data: backupRows }] = await Promise.all([
      supabase.from('system_backup_mode').select('*').maybeSingle(),
      supabase.rpc('recent_db_backups', { p_limit: 10 }),
    ]);
    setMode(modeRow || null);
    setBackups(backupRows || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const note = (text) => setSteps((prev) => [...prev, text]);

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Your session has expired. Sign in again and retry.');
    return { Authorization: `Bearer ${token}` };
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/backup', { headers: await authHeader() });
        const body = await res.json();
        setCanRun(res.ok && body.configured === true);
      } catch {
        setCanRun(false);
      }
    })();
  }, []);

  async function runBackup() {
    setBusy(true);
    setSteps([]);
    setError(null);
    setRunUrl(null);

    let frozen = false;
    try {
      const headers = await authHeader();

      note('Putting the system into backup mode…');
      const { error: freezeError } = await supabase.rpc('start_backup_mode', {
        p_reason: 'Manual backup from the admin tile',
        p_minutes: FREEZE_MINUTES,
      });
      if (freezeError) throw new Error(`Could not start backup mode: ${freezeError.message}`);
      frozen = true;
      await load();
      note(`Backup mode on. It expires by itself after ${FREEZE_MINUTES} minutes.`);

      note('Starting the backup…');
      const startRes = await fetch('/api/backup', { method: 'POST', headers });
      const start = await startRes.json();
      if (!startRes.ok) throw new Error(start.error || 'Could not start the backup.');
      if (start.url) setRunUrl(start.url);

      if (!start.runId) {
        // Dispatched, but GitHub had not listed the run yet. Thawing is right:
        // holding the school read-only while we guess is the worse trade.
        note(start.note || 'Backup started, but the run could not be tracked from here.');
        return;
      }

      await supabase.rpc('set_backup_run_reference', { p_reference: String(start.runId) });
      note('Backup running. Waiting for it to finish…');

      // Bounded by the freeze window, so this loop cannot outlive the freeze
      // it is holding open.
      const deadline = Date.now() + FREEZE_MINUTES * 60 * 1000;
      let conclusion = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled.current) return;
        const statusRes = await fetch(`/api/backup?runId=${start.runId}`, { headers });
        const status = await statusRes.json();
        if (!statusRes.ok) throw new Error(status.error || 'Lost track of the backup run.');
        if (status.status === 'completed') { conclusion = status.conclusion; break; }
      }

      if (conclusion === 'success') {
        note('Backup finished successfully.');
      } else if (conclusion) {
        throw new Error(`The backup run finished as "${conclusion}". Check the run log before relying on this backup.`);
      } else {
        throw new Error('The backup did not finish within the freeze window. Check the run log.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (frozen) {
        // Always thaw, including on the error path — a failed backup must not
        // cost the school its afternoon.
        const { error: thawError } = await supabase.rpc('end_backup_mode');
        note(thawError
          ? `Could not end backup mode: ${thawError.message}. It will expire on its own within ${FREEZE_MINUTES} minutes.`
          : 'Backup mode off. Staff can save again.');
      }
      await load();
      setBusy(false);
    }
  }

  // A 60-second signed link made with the admin's own session: storage only
  // issues it because migration 175 lets admins read db-backups, so the page
  // never holds a key that could read the bucket by itself.
  async function download(name) {
    setError(null);
    setDownloading(name);
    const { data, error: signError } = await supabase.storage
      .from('db-backups')
      .createSignedUrl(name, 60, { download: true });
    setDownloading(null);
    if (signError || !data?.signedUrl) {
      setError(`Could not download ${name}: ${signError?.message || 'no link returned'}.`);
      return;
    }
    window.location.href = data.signedUrl;
  }

  async function thawNow() {
    setBusy(true);
    const { error: thawError } = await supabase.rpc('end_backup_mode');
    if (thawError) setError(thawError.message);
    await load();
    setBusy(false);
  }

  const freezeLive = mode?.active && mode.expires_at && new Date(mode.expires_at) > new Date();

  return (
    <div>
      <h1>Run a Backup</h1>
      <p>
        Takes a full copy of the database on demand. While it runs, the system is put into
        backup mode: staff can still look things up, but nothing can be saved, so the backup is a
        clean restore point with nothing written to it part-way through.
      </p>
      <p>
        Use this before anything risky — an end-of-year rollover, a bulk import, a large data
        correction. Routine cover is the automatic nightly backup; this is for when you want a
        restore point at a moment you choose.
      </p>

      {freezeLive ? (
        <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <h2>Backup mode is on</h2>
          <p>
            Started {formatWhen(mode.started_at)}. Expires by itself at {formatWhen(mode.expires_at)}
            {mode.reason ? <> — {mode.reason}</> : null}.
          </p>
          <p>Staff cannot save changes until it ends.</p>
          <button onClick={thawNow} disabled={busy}>End backup mode now</button>
        </div>
      ) : null}

      <div className="card">
        <button onClick={runBackup} disabled={busy || freezeLive || !canRun}>
          {busy ? 'Working…' : 'Run a backup now'}
        </button>
        {' '}
        <span style={{ color: '#666', fontSize: '0.9rem' }}>
          {canRun === false
            ? 'Not available yet: the server has no GitHub token to start the backup with (GITHUB_BACKUP_TOKEN in Vercel).'
            : 'Usually takes about two minutes.'}
        </span>

        {steps.length > 0 ? (
          <ol style={{ marginTop: '1rem' }}>
            {steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        ) : null}

        {error ? (
          <p style={{ color: '#b00020' }}>
            <strong>{error}</strong>
            {runUrl ? <> <a href={runUrl} target="_blank" rel="noreferrer">Open the run log</a>.</> : null}
          </p>
        ) : null}

        {!error && runUrl && !busy ? (
          <p><a href={runUrl} target="_blank" rel="noreferrer">Open the run log</a></p>
        ) : null}
      </div>

      <div className="card">
        <h2>Recent backups</h2>
        {loading ? <p>Loading…</p> : backups.length === 0 ? (
          <p>
            No backups found. That is worth investigating — the nightly job should be producing one
            every day.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Taken</th><th>Size</th><th>File</th><th></th></tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td>{formatWhen(b.created_at)}</td>
                  <td>{formatBytes(b.size_bytes)}</td>
                  <td style={{ fontSize: '0.85rem', color: '#666' }}>{b.name}</td>
                  <td>
                    <button onClick={() => download(b.name)} disabled={downloading !== null}>
                      {downloading === b.name ? 'Preparing…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          Backups are held in the private <code>db-backups</code> store and contain personal data
          for every student and member of staff. Keep a downloaded copy on a school-controlled
          device only — never a personal laptop, email or a shared drive. Retention and
          restore-testing are set out in
          <code> docs/BACKUP_POLICY.md</code>.
        </p>
      </div>
    </div>
  );
}

export default function BackupPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/admin/backup">
        <BackupInner />
      </RequireResource>
    </RequireAuth>
  );
}
