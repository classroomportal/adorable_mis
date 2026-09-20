'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../lib/AuthContext';

export default function RequireAuth({ children }) {
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (session && profile?.must_change_password && pathname !== '/change-password') {
      router.push('/change-password');
    }
  }, [session, profile, pathname, router]);

  if (loading || !session) return <p>Loading...</p>;
  return children;
}
