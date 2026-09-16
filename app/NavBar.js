'use client';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function NavBar() {
  const { session, profile } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('splashShown');
    router.push('/login');
  }

  return (
    <nav>
      <a
        href="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginRight: 'auto',
          padding: '0.2rem 0',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2rem',
            height: '2rem',
            borderRadius: 8,
            background: 'var(--brand-700)',
            color: 'white',
            fontWeight: 800,
            fontSize: '0.95rem',
          }}
        >
          F
        </span>
        <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--ink)' }}>Formwork</span>
      </a>
      {session ? (
        <>
          <span style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>
            {profile?.role === 'admin' ? 'Admin' : profile?.role === 'student' ? 'Student' : profile?.role === 'parent' ? 'Parent' : 'Staff'} — {session.user.email}
          </span>
          <a href="/change-password">Change Password</a>
          <button onClick={handleSignOut}>Sign out</button>
        </>
      ) : (
        <a href="/login">Sign in</a>
      )}
    </nav>
  );
}
