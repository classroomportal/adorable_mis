'use client';
import { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/change-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    // Always show the same success message regardless of whether the email
    // exists, so this can't be used to check who has an account.
    else setStatus('If that email has an account, a password reset link has been sent.');
  }

  return (
    <div style={{ maxWidth: 380, margin: '3rem auto' }}>
      <h1>Reset password</h1>
      <p>Enter your account email and we'll send a link to set a new password.</p>
      <form onSubmit={handleSubmit} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}</button>
        {error && <p style={{ color: '#a3232c' }}>{error}</p>}
        {status && <p>{status}</p>}
      </form>
      <p><a href="/login">Back to sign in</a></p>
    </div>
  );
}
