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

  // Auth events can arrive many times for the same sign-in (the principal's
  // Mac, 9 Oct 2026: several a second, so /students kept flashing and
  // restarting). The same token keeps the same session object, so nothing
  // downstream re-runs.
  useEffect(() => {
    const keep = (sess) => setSession((prev) => (
      prev && sess && prev.access_token === sess.access_token ? prev : sess
    ));
    supabase.auth.getSession().then(({ data }) => keep(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      keep(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // The profile, roles and page grants belong to the person, not the token:
  // reload them only when someone else signs in (or out). Reloading on every
  // token refresh set profileLoaded false, which made RequireResource swap
  // the page for "Loading..." and back, throwing away whatever it had loaded.
  const userId = session === undefined ? undefined : (session?.user?.id ?? null);
  useEffect(() => {
    if (userId === undefined) return;
    let cancelled = false;
    async function loadProfile() {
      setProfileLoaded(false);
      if (!userId) { setProfile(null); setStaffRoles([]); setAccessibleResources(new Set()); setProfileLoaded(true); return; }
      const readProfile = () => supabase.from('profiles').select('*').eq('id', userId).single();
      let { data, status } = await readProfile();
      if (cancelled) return;
      // A 401 means the browser still holds a sign-in the server no longer
      // accepts (usually signed out on another device: Sign out is global).
      // Without this every page said "You don't have access to this page. Ask
      // an admin…" to a teacher who had access (BLK, 9 Oct 2026). Try a
      // refresh once; if that fails, sign out here so RequireAuth sends them
      // to the login page.
      if (status === 401) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (cancelled) return;
        if (!refreshError) ({ data, status } = await readProfile());
        if (cancelled) return;
        if (refreshError || status === 401) {
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }
      }
      setProfile(data || null);
      if (data?.staff_id) {
        const { data: roles } = await supabase.from('staff_roles').select('role_name').eq('staff_id', data.staff_id);
        if (cancelled) return;
        const roleNames = (roles || []).map((r) => r.role_name);
        setStaffRoles(roleNames);
        // Admin bypasses this entirely (see hasAccess below), so skip the
        // fetch for admins rather than pulling every resource_key.
        if (data?.role !== 'admin' && roleNames.length > 0) {
          const { data: grants } = await supabase.from('role_permissions').select('resource_key').in('role_name', roleNames);
          if (cancelled) return;
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
    return () => { cancelled = true; };
  }, [userId]);

  const isPastoralOrSmt = profile?.role === 'admin' || staffRoles.includes('smt') || staffRoles.includes('houseparent') || staffRoles.includes('head_of_boarding') || staffRoles.includes('pastoral');
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
