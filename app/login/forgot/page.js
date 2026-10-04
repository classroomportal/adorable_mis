'use client';
import { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

// Mainly for parents: they sign in with an email and password. Staff and
// students sign in with their school Google account, so the page points them
// back there first. Same look as /login (the login-* classes in globals.css).
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // Hardcoded rather than window.location.origin: whoever submits this
    // form from a local dev server (or any other non-canonical origin) would
    // otherwise get a reset email whose link points nowhere reachable —
    // Supabase still verifies the token fine, but the browser can never load
    // the page to actually set a new password, so the reset silently fails.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://misform.work/change-password',
    });
    setLoading(false);
    if (error) setError(error.message);
    // The same message whether or not the email has an account, so this
    // can't be used to check who has one.
    else setSent(true);
  }

  return (
    <div className="login-page">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-card">
        <div className="login-crest-wrap">
          <img src="/logo.png" alt="Adorable British College" className="login-crest" />
        </div>
        <h1>Forgotten your password?</h1>
        <p className="login-sub">Enter the email you sign in with and we&apos;ll send you a link to choose a new one.</p>

        <p className="login-note">
          <strong>Staff and students:</strong> you don&apos;t need a password. <a href="/login">Sign in with your school account</a> instead.
        </p>

        {sent ? (
          <div className="login-success" role="status">
            <div className="login-success-icon" aria-hidden="true">✉️</div>
            <p><strong>Check your email.</strong></p>
            <p>If that email has an account, a link to choose a new password is on its way. It can take a few minutes, so check your spam or junk folder too.</p>
            <p>Nothing after 15 minutes? Ask the school office to resend your welcome letter.</p>
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
