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
    // Hardcoded rather than window.location.origin: whoever submits this
    // form from a local dev server (or any other non-canonical origin) would
    // otherwise get a reset email whose link points nowhere reachable —
    // Supabase still verifies the token fine, but the browser can never load
    // the page to actually set a new password, so the reset silently fails.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://misform.work/change-password',
    });
    setLoading(false);
    if (error) setError(error.message);
    // Always show the same success message regardless of whether the email
    // exists, so this can't be used to check who has an account.
    else setStatus('If that email has an account, a password reset link has been sent.');
  }

  return (
    <div className="login-page">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-card">
        <div className="login-crest-wrap">
          <img src="/logo.png" alt="Adorable British College" className="login-crest" />
        </div>
        <h1>Forgotten your password?</h1>
        <p className="login-sub">Enter your email and we&apos;ll send you a link to choose a new one.</p>

        {/* Staff and students don't need a Formwork password at all. */}
        <p className="login-note">
          <strong>Staff and students:</strong> you can <a href="/login">sign in with your school account</a> instead,
          with no password to remember.
        </p>

        {status ? (
          <div className="login-success" role="status">
            <div className="login-success-icon" aria-hidden="true">✉️</div>
            <p><strong>Check your email.</strong></p>
            <p>{status} It can take a few minutes, so check your spam or junk folder too.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <button type="submit" className="login-primary" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}

        <a href="/login" className="login-back">← Back to sign in</a>
      </div>
      <p className="login-motto">Esse Maximum, Esse Adoramus</p>
    </div>
  );
}
