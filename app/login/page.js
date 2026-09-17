'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

// Staff and students are all issued an @abc.sch.ng address, so for that
// group we only need the part before the @ and can append the domain
// ourselves. Parents are NOT on a shared domain (real data: mostly gmail/
// yahoo/hotmail/etc, only a handful on @abc.sch.ng), so there's nothing
// consistent to append for them — they still enter their full email.
const STAFF_STUDENT_DOMAIN = 'abc.sch.ng';

export default function LoginPage() {
  const [loginAs, setLoginAs] = useState('staff'); // 'staff' | 'parent'
  const [username, setUsername] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
