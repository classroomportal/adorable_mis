import { supabase } from './supabaseClient';

// Finds the parents row for the signed-in user's email, for staff who are
// also parents but whose login isn't linked to it through profiles.parent_id.
// The database matches profiles.email, else the sign-in email, ignoring case,
// and returns only a row the caller could already read (migration 316).
// It used to be an ilike over every parent through RLS, about a second on
// every staff dashboard load.
export async function findMyParentId() {
  const { data } = await supabase.rpc('my_parent_id_by_email');
  return data || null;
}
