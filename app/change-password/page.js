'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useAuth } from '../../lib/AuthContext';

function ChangePasswordInner() {
  const { profile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!error && profile?.must_change_password) {
      await supabase.rpc('clear_must_change_password');
    }
    setLoading(false);
    if (error) {
      // Supabase refuses a new password equal to the current one; for a
      // parent on their first sign-in that's their child's date of birth.
      setError(/different from the old password/i.test(error.message)
        ? 'Please choose a new password. It cannot be the same as the one you signed in with.'
        : error.message);
    } else {
      setStatus('Password updated.');
      // Full reload rather than router.push: the profile in AuthContext
      // still says must_change_password, and RequireAuth would bounce
      // straight back here until it's re-read.
      setTimeout(() => { window.location.href = '/'; }, 1000);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '2rem auto' }}>
      <h1>Change Password</h1>
      {profile?.must_change_password && (
        <p style={{ color: '#a3232c' }}>Welcome! Before you continue, please choose your own password. It must be at least 8 characters. You will use this new password every time you sign in from now on.</p>
      )}
      <form onSubmit={handleSubmit} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Update password'}</button>
        {error && <p style={{ color: '#a3232c' }}>{error}</p>}
        {status && <p>{status}</p>}
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return <RequireAuth><ChangePasswordInner /></RequireAuth>;
}
