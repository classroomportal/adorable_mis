'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [staffRoles, setStaffRoles] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function loadProfile() {
      if (!session?.user) { setProfile(null); setStaffRoles([]); return; }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      setProfile(data || null);
      if (data?.staff_id) {
        const { data: roles } = await supabase.from('staff_roles').select('role_name').eq('staff_id', data.staff_id);
        setStaffRoles((roles || []).map((r) => r.role_name));
      } else {
        setStaffRoles([]);
      }
    }
    loadProfile();
  }, [session]);

  const isPastoralOrSmt = profile?.role === 'admin' || staffRoles.includes('smt') || staffRoles.includes('houseparent');

  return (
    <AuthContext.Provider value={{ session, profile, staffRoles, isPastoralOrSmt, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
