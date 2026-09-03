'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import RequireAuth from '../RequireAuth';
import { useRouter } from 'next/navigation';

function ChangePasswordInner() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setError(error.message);
    else {
      setStatus('Password updated.');
      setTimeout(() => router.push('/'), 1000);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '2rem auto' }}>
      <h1>Change Password</h1>
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
