import { supabase } from './supabaseClient';

// Finds the parents row for a sign-in email, for staff who are also parents
// but whose login isn't linked to it through profiles.parent_id. Pass the
// session's email: profiles.email is empty for most logins. Matched without
// regard to case (parent emails were imported as typed), with % and _
// escaped so they can't act as wildcards and match someone else's address.
export async function findParentIdByEmail(email) {
  if (!email) return null;
  const pattern = email.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await supabase
    .from('parents')
    .select('parent_id')
    .ilike('email', pattern)
    .order('parent_id')
    .limit(1);
  return data?.[0]?.parent_id || null;
}
