'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

// Everything here goes through parent_welcome_candidates() and
// send_parent_welcome_batch() (migration 172). The database works out each
// parent's date-of-birth password and records every send, so this page never
// handles a password and can't email the same parent twice.

const STATUS_LABELS = {
  ready: 'Not sent yet',
  sent: 'Already sent',
  signed_in: 'Already signed in',
  no_email: 'No email address',
  no_dob: 'No date of birth for their child',
  email_shared: "Email used by another parent's login",
};

const SHOW_OPTIONS = [
  { value: 'ready', label: 'Not sent yet' },
  { value: 'sent', label: 'Already sent' },
  { value: 'blocked', label: "Can't be sent" },
  { value: 'all', label: 'Everyone' },
];

// globals.css stacks every <label> as a column that grows to fill the row;
// these sit inline instead (tick-box beside its text).
const INLINE_LABEL = {
  display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '0.4rem', flex: '0 0 auto', fontSize: '0.95rem', whiteSpace: 'nowrap',
};

function formatSentAt(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function WelcomeEmailsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [emailSetting, setEmailSetting] = useState(null); // { paused, note } once loaded
  const [pauseReason, setPauseReason] = useState('');
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [years, setYears] = useState(new Set());
  const [show, setShow] = useState('ready');
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: settings }] = await Promise.all([
      supabase.rpc('parent_welcome_candidates'),
      supabase.from('system_settings').select('parent_emails_paused, parent_emails_paused_note').maybeSingle(),
    ]);
    setLoadError(error ? error.message : null);
    setCandidates(data || []);
    setEmailSetting(settings ? { paused: settings.parent_emails_paused, note: settings.parent_emails_paused_note } : null);
    setLoading(false);
  }

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const allYears = useMemo(() => {
    const ys = new Set();
    candidates.forEach((c) => (c.years || []).forEach((y) => ys.add(y)));
    return [...ys].sort((a, b) => a - b);
  }, [candidates]);

  // A parent with children in more than one year shows under each of them;
  // once sent, they're "Already sent" everywhere.
  const inYears = useMemo(
    () => candidates.filter((c) => (c.years || []).some((y) => years.has(y))),
    [candidates, years],
  );

  const counts = useMemo(() => {
    const out = { ready: 0, sent: 0, blocked: 0 };
    inYears.forEach((c) => {
      if (c.status === 'ready') out.ready += 1;
      else if (c.status === 'sent') out.sent += 1;
      else out.blocked += 1;
    });
    return out;
  }, [inYears]);

  const shown = inYears.filter((c) => {
    if (show === 'all') return true;
    if (show === 'blocked') return c.status !== 'ready' && c.status !== 'sent';
    return c.status === show;
  });

  const chosen = inYears.filter((c) => c.status === 'ready' && selected.has(c.parent_id));

  function toggleYear(y) {
    const next = new Set(years);
    if (next.has(y)) next.delete(y); else next.add(y);
    setYears(next);
    // Default to everyone sendable in the chosen years; untick to hold back.
    setSelected(new Set(
      candidates
        .filter((c) => c.status === 'ready' && (c.years || []).some((yy) => next.has(yy)))
        .map((c) => c.parent_id),
    ));
    setResults(null);
  }

  function toggleParent(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllReady(on) {
    setSelected(on ? new Set(inYears.filter((c) => c.status === 'ready').map((c) => c.parent_id)) : new Set());
  }

  async function handleSend() {
    const yearList = [...years].sort((a, b) => a - b).map((y) => `Y${y}`).join(', ');
    if (!window.confirm(`Email the welcome letter to ${chosen.length} parent${chosen.length === 1 ? '' : 's'} (${yearList})? Each parent is only ever sent it once.`)) return;
    setSending(true);
    setResults(null);
    const { data, error } = await supabase.rpc('send_parent_welcome_batch', {
      p_parent_ids: chosen.map((c) => c.parent_id),
    });
    setSending(false);
    if (error) {
      setResults({ error: error.message });
      return;
    }
    setResults({ rows: data || [] });
    await load();
    setSelected(new Set());
  }

  // The pause (migration 114) covers every email to a parent, not just this
  // page's letters, so resuming is confirmed with that spelled out.
  async function setEmailsPaused(pause) {
    const question = pause
      ? 'Pause all emails to parents? Welcome letters and individual messages to parents will stop sending until someone resumes them.'
      : 'Resume emails to parents? Welcome letters can be sent from this page again, and individual messages staff send to a parent will be emailed to them again.';
    if (!window.confirm(question)) return;
    setSwitching(true);
    setSwitchError(null);
    const { error } = await supabase.rpc('set_parent_emails_paused', {
      p_paused: pause,
      p_note: pause ? pauseReason : null,
    });
    if (error) setSwitchError(error.message);
    else setPauseReason('');
    await load();
    setSwitching(false);
  }

  if (!isAdmin) return <p>Only admin can send welcome emails.</p>;

  const paused = emailSetting?.paused ?? true; // unknown counts as paused: never offer Send on a guess
  const sendDisabled = sending || paused || chosen.length === 0;
  const sentCount = results?.rows?.filter((r) => r.outcome === 'Sent').length ?? 0;
  const notSent = results?.rows?.filter((r) => r.outcome !== 'Sent') ?? [];

  return (
    <div>
      <h1>Send Parent Welcome Emails</h1>

      {emailSetting && (
        <div className="card" style={{ borderLeft: `4px solid ${paused ? '#b45309' : '#15803d'}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: paused ? '#b45309' : '#15803d' }}>
                {paused ? 'Emails to parents are paused' : 'Emails to parents are on'}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: '#555' }}>
                Covers welcome letters and individual messages staff send to a parent.
                {emailSetting.note ? ` ${emailSetting.note.replace(/[.\s]*$/, '')}.` : ''}
              </p>
            </div>
            {paused ? (
              <button type="button" onClick={() => setEmailsPaused(false)} disabled={switching}>
                {switching ? 'Saving…' : 'Resume parent emails'}
              </button>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  placeholder="Reason (optional)"
                  style={{ width: '14rem' }}
                  disabled={switching}
                />
                <button type="button" className="secondary" onClick={() => setEmailsPaused(true)} disabled={switching}>
                  {switching ? 'Saving…' : 'Pause parent emails'}
                </button>
              </div>
            )}
          </div>
          {switchError && <p style={{ color: '#b91c1c', margin: '0.5rem 0 0' }}>{switchError}</p>}
        </div>
      )}

      <div className="card">
        <p style={{ marginTop: 0 }}>
          Choose year groups to send the welcome letter to parents of those students. Each parent&apos;s first password is their oldest
          current child&apos;s date of birth (DDMMYYYY), and they must choose their own the first time they sign in. A parent is only
          ever sent the letter once, and parents who have already signed in are never sent it.
        </p>

        {loading ? <p>Loading parents…</p> : loadError ? <p style={{ color: '#b91c1c' }}>Couldn&apos;t load parents: {loadError}</p> : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'center' }}>
              <strong>Year groups:</strong>
              {allYears.map((y) => (
                <label key={y} style={INLINE_LABEL}>
                  <input type="checkbox" checked={years.has(y)} onChange={() => toggleYear(y)} disabled={sending} />
                  Year {y}
                </label>
              ))}
            </div>

            {years.size > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'center', marginTop: '0.75rem' }}>
                <label style={INLINE_LABEL}>
                  Show
                  <select value={show} onChange={(e) => setShow(e.target.value)}>
                    {SHOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <span style={{ color: '#555' }}>
                  {counts.ready} not sent yet · {counts.sent} already sent · {counts.blocked} can&apos;t be sent
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {years.size > 0 && !loading && (
        <div className="card">
          {show === 'ready' && counts.ready > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <button type="button" className="secondary" onClick={() => selectAllReady(true)} disabled={sending} style={{ marginRight: '0.5rem' }}>Select all</button>
              <button type="button" className="secondary" onClick={() => selectAllReady(false)} disabled={sending}>Select none</button>
            </div>
          )}

          {shown.length === 0 ? (
            <p>No parents to show for this filter.</p>
          ) : (
            <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #ddd' }}>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr><th></th><th>Parent</th><th>Email</th><th>Children</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.parent_id}>
                      <td>
                        {c.status === 'ready' && (
                          <input type="checkbox" checked={selected.has(c.parent_id)} onChange={() => toggleParent(c.parent_id)} disabled={sending} />
                        )}
                      </td>
                      <td>{c.parent_name || '(no name)'}</td>
                      <td>{c.email || '—'}</td>
                      <td>{c.children}</td>
                      <td>
                        {STATUS_LABELS[c.status] || c.status}
                        {c.status === 'sent' && c.sent_at ? ` (${formatSentAt(c.sent_at)})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={handleSend}
              disabled={sendDisabled}
              style={sendDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {sending ? 'Sending…' : `Send to ${chosen.length} parent${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="card">
          {results.error ? (
            <p style={{ color: '#b91c1c', margin: 0 }}>Nothing was sent: {results.error}</p>
          ) : (
            <>
              <p style={{ marginTop: 0, fontWeight: 600 }}>Sent to {sentCount} parent{sentCount === 1 ? '' : 's'}.</p>
              {notSent.length > 0 && (
                <>
                  <p>Not sent ({notSent.length}):</p>
                  <ul style={{ margin: 0 }}>
                    {notSent.map((r) => {
                      const c = candidates.find((x) => x.parent_id === r.parent_id);
                      return <li key={r.parent_id}>{c?.parent_name || r.email || `Parent ${r.parent_id}`}: {r.outcome}</li>;
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function WelcomeEmailsPage() {
  return <RequireAuth><RequireResource resourceKey="/parents/welcome-emails"><WelcomeEmailsInner /></RequireResource></RequireAuth>;
}
