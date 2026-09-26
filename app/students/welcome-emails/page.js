'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import RequireAuth from '../../RequireAuth';
import RequireResource from '../../RequireResource';
import { useAuth } from '../../../lib/AuthContext';

// Supabase Auth rate-limits /recover (it shows up in the auth logs as
// over_email_send_rate_limit). Sending the whole list in a tight loop trips
// it partway through, so space the sends out and report what actually landed.
const SEND_SPACING_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StudentWelcomeEmailsInner() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.rpc('student_never_signed_in');
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows(data || []);
      setSelected(new Set((data || []).map((r) => r.email)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  function toggle(email) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  async function handleSend() {
    const targets = rows.filter((r) => selected.has(r.email));
    if (targets.length === 0) return;
    setSending(true);
    setResults([]);
    const out = [];
    for (let i = 0; i < targets.length; i += 1) {
      const r = targets[i];
      setProgress(`Sending ${i + 1} of ${targets.length} — ${r.email}`);
      // Same call as /login/forgot, so students get the ordinary reset link
      // and set their own password. No temporary password is generated or emailed.
      const { error } = await supabase.auth.resetPasswordForEmail(r.email, {
        redirectTo: 'https://misform.work/change-password',
      });
      out.push({ email: r.email, student_name: r.student_name, error: error ? error.message : null });
      setResults([...out]);
      if (i < targets.length - 1) await sleep(SEND_SPACING_MS);
    }
    setProgress(null);
    setSending(false);
  }

  if (!isAdmin) return <p>Only admin can send student login emails.</p>;

  const sentOk = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error);

  return (
    <div>
      <h1>Student Login Emails</h1>

      <div className="card">
        <p>
          Student logins are created automatically as soon as a student record is given a school
          email address, so there is nothing to create here. This page is for current students whose
          account exists but who have <strong>never signed in</strong> — it sends them a link to set
          their own password.
        </p>
        <p style={{ fontSize: '0.9rem', color: '#555' }}>
          This is the same reset link as &quot;Forgot password?&quot; on the sign-in page, so it goes
          out through Supabase Auth using the sender configured under Authentication → Emails. That
          is separate from the <code>mis@abc.sch.ng</code> Workspace sender the app&apos;s other
          emails use — send one to yourself first if you are unsure which address students will see.
        </p>
      </div>

      {loading && <p>Loading...</p>}
      {loadError && <p style={{ color: '#a3232c' }}>Could not load students: {loadError}</p>}

      {!loading && !loadError && rows.length === 0 && (
        <div className="card">
          <p>Every current student with an email has signed in at least once. Nothing to send.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <p>{rows.length} student(s) have never signed in.</p>
          <table>
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Year</th>
                <th>Login email</th>
                <th>Account created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.email)}
                      onChange={() => toggle(r.email)}
                      disabled={sending}
                    />
                  </td>
                  <td>{r.student_name}</td>
                  <td>{r.year_group ?? ''}</td>
                  <td>{r.email}</td>
                  <td>{r.account_created ? String(r.account_created).slice(0, 10) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={handleSend}
            disabled={sending || selected.size === 0}
            style={{ marginTop: '0.75rem' }}
          >
            {sending ? 'Sending...' : `Send password-set link to ${selected.size} student${selected.size === 1 ? '' : 's'}`}
          </button>

          <button onClick={load} disabled={sending} style={{ marginLeft: '0.5rem' }}>
            Refresh list
          </button>
        </div>
      )}

      {progress && <p>{progress}</p>}

      {results.length > 0 && !sending && (
        <div className="card">
          <p>
            Sent {sentOk} of {results.length}.
          </p>
          {failed.length > 0 && (
            <>
              <p style={{ color: '#b45309', fontWeight: 600 }}>
                {failed.length} did not send. Supabase Auth rate-limits reset emails — if that is
                what these say, wait a few minutes and send just those again.
              </p>
              <ul>
                {failed.map((f) => (
                  <li key={f.email}>
                    {f.email}: {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p style={{ fontSize: '0.9rem', color: '#555' }}>
            Students stay on this list until they actually sign in, so &quot;Refresh list&quot; is the
            way to see who still has not used their link.
          </p>
        </div>
      )}
    </div>
  );
}

export default function StudentWelcomeEmailsPage() {
  return (
    <RequireAuth>
      <RequireResource resourceKey="/students/welcome-emails">
        <StudentWelcomeEmailsInner />
      </RequireResource>
    </RequireAuth>
  );
}
