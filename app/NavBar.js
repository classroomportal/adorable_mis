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
    <nav>
      <a href="/" style={{ fontWeight: 700, marginRight: 'auto' }}>Adorable MIS</a>
      <a href="/">Home</a>
      <a href="/students">Students</a>
      <a href="/results">Results</a>
      <a href="/behaviour">Behaviour</a>
      <a href="/attendance">Attendance</a>
      <a href="/calendar">Calendar</a>
      {profile?.role === 'admin' && <a href="/staff/roles">Staff & Roles</a>}
      {session ? (
        <>
          <span style={{ color: '#ffe9c7', fontSize: '0.8rem' }}>
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
