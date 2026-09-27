'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/AuthContext';

// Staff and students are all issued an @abc.sch.ng address, so for that
// group we only need the part before the @ and can append the domain
// ourselves. Parents are NOT on a shared domain (real data: mostly gmail/
// yahoo/hotmail/etc, only a handful on @abc.sch.ng), so there's nothing
// consistent to append for them — they still enter their full email.
const STAFF_STUDENT_DOMAIN = 'abc.sch.ng';

// Google sign-in (the school's Workspace) for staff and students. It only
// ever links to a login Formwork already made: the database refuses to
// create a new one (migration 221), and Supabase sends the person back here
// with an error, which is explained below rather than shown raw.
function googleErrorMessage(params) {
  const code = params.get('error') || '';
  const desc = (params.get('error_description') || '').replace(/\+/g, ' ');
  if (!code && !desc) return null;
  if (code === 'access_denied' && !/database|formwork/i.test(desc)) return 'Google sign-in was cancelled.';
  if (/database error saving new user|formwork_no_account|banned/i.test(desc)) {
    return 'That Google account isn\'t set up in Formwork yet. Ask the school office to add you, or sign in with your Formwork username and password.';
  }
  return `Google sign-in didn't work: ${desc || code}. Try again, or sign in with your password.`;
}

export default function LoginPage() {
  const [loginAs, setLoginAs] = useState('staff'); // 'staff' | 'parent'
  const [username, setUsername] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { session } = useAuth();

  // Coming back from Google: an error arrives in the address (query or
  // hash); a success arrives as a session, so go on to the dashboard.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const message = googleErrorMessage(query) || googleErrorMessage(hash);
    if (message) {
      setError(message);
      window.history.replaceState(null, '', '/login');
    }
  }, []);

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/login`,
        // hd shows only school accounts in Google's chooser; it's a hint,
        // not the check (the database is, migration 221).
        queryParams: { hd: STAFF_STUDENT_DOMAIN, prompt: 'select_account' },
      },
    });
    if (e) { setLoading(false); setError(e.message); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const email = loginAs === 'staff'
      ? (username.includes('@') ? username.trim() : `${username.trim()}@${STAFF_STUDENT_DOMAIN}`)
      : parentEmail.trim();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else router.push('/');
  }

  return (
    <div style={{ maxWidth: 380, margin: '3rem auto' }}>
      <h1>Sign in</h1>
      {loginAs === 'staff' && (
        <>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={loading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              background: '#ffffff', color: '#1f2933', border: '1px solid #c9ced6', padding: '0.7rem 1rem',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z" />
              <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
            </svg>
            Sign in with your school Google account
          </button>
          <p style={{ textAlign: 'center', color: 'var(--ink-soft)', margin: '0.9rem 0 0.3rem' }}>or use your Formwork password</p>
        </>
      )}
      <form onSubmit={handleSubmit} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          I am a...
          <select value={loginAs} onChange={(e) => setLoginAs(e.target.value)}>
            <option value="staff">ABC Staff / Student</option>
            <option value="parent">ABC Parent</option>
          </select>
        </label>

        {loginAs === 'staff' ? (
          <label>
            Username
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="jbloggs"
                autoComplete="username"
                required
                style={{ flex: 1 }}
              />
              {!username.includes('@') && (
                <span style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>@{STAFF_STUDENT_DOMAIN}</span>
              )}
            </div>
          </label>
        ) : (
          <label>
            Email
            <input
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
        )}

        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
        {error && <p style={{ color: '#a3232c' }}>{error}</p>}
      </form>
      <p><a href="/login/forgot">Forgot password?</a></p>
    </div>
  );
}
