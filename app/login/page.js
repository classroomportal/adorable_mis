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
  if (code === 'access_denied' && !/database|formwork/i.test(desc)) return 'Signing in with your school account was cancelled.';
  if (/database error saving new user|formwork_no_account|banned/i.test(desc)) {
    return 'That school account isn\'t set up here yet. Ask the school office to add you, or choose "Sign in with a password instead".';
  }
  return `Signing in with your school account didn't work: ${desc || code}. Try again, or choose "Sign in with a password instead".`;
}

export default function LoginPage() {
  const [loginAs, setLoginAs] = useState('staff'); // 'staff' | 'parent'
  const [username, setUsername] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Staff and students sign in with their school (Google) account; the
  // password form is kept behind a link for anyone who still needs it
  // (an account not yet linked, the admin login, or Google being down).
  const [showPassword, setShowPassword] = useState(false);
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
    // A login set to Google only (migration 372) is refused by the database
    // once the password has been checked, which Supabase reports as a
    // database error.
    if (error) setError(/database error|google_only/i.test(error.message)
      ? 'This account signs in with Google only. Use "Sign in with Google".'
      : error.message);
    else router.push('/');
  }

  const googleIcon = (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );

  const passwordForm = (
    <form onSubmit={handleSubmit} className="login-form">
      {loginAs === 'staff' ? (
        <label>
          Username
          <div className="login-username">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jbloggs"
              autoComplete="username"
              required
            />
            {!username.includes('@') && <span>@{STAFF_STUDENT_DOMAIN}</span>}
          </div>
        </label>
      ) : (
        <label>
          Email address
          <input
            type="email"
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@example.com"
            required
          />
        </label>
      )}
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <button type="submit" className="login-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      <a href="/login/forgot" className="login-forgot">Forgot your password?</a>
    </form>
  );

  return (
    <div className="login-page">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-card">
        <div className="login-crest-wrap">
          <img src="/logo.png" alt="Adorable British College" className="login-crest" />
        </div>
        <h1>Welcome</h1>
        <p className="login-sub">Sign in to the Adorable British College portal</p>

        {/* Who you are comes first: the school-account button is only for
            staff and students, so a parent never sees it. */}
        <div className="login-roles" role="radiogroup" aria-label="I am a">
          {[
            { key: 'staff', title: 'Staff or student', icon: '🎓' },
            { key: 'parent', title: 'Parent', icon: '👪' },
          ].map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={loginAs === r.key}
              className={`login-role${loginAs === r.key ? ' is-active' : ''}`}
              onClick={() => { setLoginAs(r.key); setError(null); }}
            >
              <span className="login-role-icon" aria-hidden="true">{r.icon}</span>
              {r.title}
            </button>
          ))}
        </div>

        {loginAs === 'staff' ? (
          <>
            <button type="button" className="login-school" onClick={signInWithGoogle} disabled={loading}>
              {googleIcon}
              Sign in with your school account
            </button>
            <p className="login-hint">Use your @{STAFF_STUDENT_DOMAIN} email</p>
            {showPassword ? (
              <>
                <div className="login-divider"><span>or with a password</span></div>
                {passwordForm}
              </>
            ) : (
              <button
                type="button"
                className="login-link"
                onClick={() => { setShowPassword(true); setError(null); }}
              >
                Sign in with a password instead
              </button>
            )}
          </>
        ) : passwordForm}

        {error && <p className="login-error" role="alert">{error}</p>}
      </div>
      <p className="login-motto">Esse Maximum, Esse Adoramus</p>
    </div>
  );
}
