'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [staffRoles, setStaffRoles] = useState([]);
  const [accessibleResources, setAccessibleResources] = useState(new Set());
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function loadProfile() {
      setProfileLoaded(false);
      if (!session?.user) { setProfile(null); setStaffRoles([]); setAccessibleResources(new Set()); setProfileLoaded(true); return; }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      setProfile(data || null);
      if (data?.staff_id) {
        const { data: roles } = await supabase.from('staff_roles').select('role_name').eq('staff_id', data.staff_id);
        const roleNames = (roles || []).map((r) => r.role_name);
        setStaffRoles(roleNames);
        // Admin bypasses this entirely (see hasAccess below), so skip the
        // fetch for admins rather than pulling every resource_key.
        if (data?.role !== 'admin' && roleNames.length > 0) {
          const { data: grants } = await supabase.from('role_permissions').select('resource_key').in('role_name', roleNames);
          setAccessibleResources(new Set((grants || []).map((g) => g.resource_key)));
        } else {
          setAccessibleResources(new Set());
        }
      } else {
        setStaffRoles([]);
        setAccessibleResources(new Set());
      }
      setProfileLoaded(true);
    }
    loadProfile();
  }, [session]);

  const isPastoralOrSmt = profile?.role === 'admin' || staffRoles.includes('smt') || staffRoles.includes('houseparent') || staffRoles.includes('pastoral');
  // Page-level access is a UX nicety here, not the security boundary — RLS
  // in Postgres is what actually protects data (see CLAUDE.md). This just
  // decides what the dashboard/pages show, backed by the resources/
  // role_permissions tables an admin edits at /admin/permissions.
  const hasAccess = (resourceKey) => profile?.role === 'admin' || accessibleResources.has(resourceKey);

  return (
    <AuthContext.Provider value={{ session, profile, staffRoles, isPastoralOrSmt, hasAccess, profileLoaded, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
