'use client';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function NavBar() {
  const { session, profile } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <nav style={{ padding: '1rem 1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
      <a href="/" style={{ fontWeight: 700, marginRight: 'auto' }}>Adorable MIS</a>
      <a href="/">Home</a>
      <a href="/students">Students</a>
      <a href="/results">Results</a>
      <a href="/behaviour">Behaviour</a>
      <a href="/attendance">Attendance</a>
      {session ? (
        <>
          <span style={{ color: '#cfe0f7', fontSize: '0.85rem' }}>
            {profile?.role === 'admin' ? 'Admin' : 'Staff'} — {session.user.email}
          </span>
          <button onClick={handleSignOut}>Sign out</button>
        </>
      ) : (
        <a href="/login">Sign in</a>
      )}
    </nav>
  );
}
