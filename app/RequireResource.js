'use client';
import { useAuth } from '../lib/AuthContext';

// Gate a page behind a resource_key from the resources/role_permissions
// tables (see /admin/permissions). This is a UX guard, not the security
// boundary — RLS in Postgres is what actually protects data — so a wrong
// grant here means a confusing page, not a data leak.
export default function RequireResource({ resourceKey, children }) {
  const { profileLoaded, hasAccess } = useAuth();

  if (!profileLoaded) return <p>Loading...</p>;
  if (!hasAccess(resourceKey)) return <p>You don&apos;t have access to this page. Ask an admin to grant it at /admin/permissions.</p>;
  return children;
}
