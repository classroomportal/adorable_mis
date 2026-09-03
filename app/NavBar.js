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
      <a href="/" style={{ fontWeight: 800, fontSize: '1.3rem', marginRight: 'auto', padding: '0.3rem 0' }}>Adorable MIS</a>
      {session ? (
        <>
          <span style={{ color: '#ffe9c7', fontSize: '0.8rem' }}>
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
