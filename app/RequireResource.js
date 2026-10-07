'use client';
import { useAuth } from '../lib/AuthContext';

// Gate a page behind a resource_key from the resources/role_permissions
// tables (see /admin/permissions). This is a UX guard, not the security
// boundary — RLS in Postgres is what actually protects data — so a wrong
// grant here means a confusing page, not a data leak.
export default function RequireResource({ resourceKey, children }) {
  const { profileLoaded, hasAccess, staffRoles } = useAuth();

  if (!profileLoaded) return <p>Loading...</p>;
  if (!hasAccess(resourceKey)) return <p>You don&apos;t have access to this page. Ask an admin to grant it at /admin/permissions.</p>;
  // Medical records are for the nurse and the DSL only (migration 363): the
  // database returns nothing to anyone else, admins included, so say so
  // rather than show empty lists. Admins still see the Clinic tile.
  if (isClinicPage(resourceKey) && !holdsMedicalRole(staffRoles)) {
    return (
      <main style={{ padding: '1.25rem', maxWidth: 700, margin: '0 auto' }}>
        <h1>Access not allowed</h1>
        <p>Clinic and medical records are for the nurse and the Designated Safeguarding Lead only.</p>
      </main>
    );
  }
  // The Worry Box, wellbeing check-ins and the school rating (migrations
  // 391–394) are for the DSL and the principal only, on
  // the roles themselves; admins get nothing from the database.
  if (['/worry-box', '/wellbeing', '/school-rating'].includes(resourceKey) && !(staffRoles || []).some((r) => r === 'dsl' || r === 'principal')) {
    return (
      <main style={{ padding: '1.25rem', maxWidth: 700, margin: '0 auto' }}>
        <h1>Access not allowed</h1>
        <p>The Worry Box, wellbeing check-ins and the school rating are for the Designated Safeguarding Lead and the Principal only.</p>
      </main>
    );
  }
  return children;
}

function isClinicPage(resourceKey) {
  return resourceKey === '/clinic' || resourceKey?.startsWith('/clinic/');
}

export function holdsMedicalRole(staffRoles) {
  return (staffRoles || []).some((r) => r === 'nurse' || r === 'dsl');
}
