// Authorisation for app/api route handlers. Every route must start with:
//
//   const auth = await requireResource(request, '/some/resource-key');
//   if (auth.denied) return auth.denied;
//
// scripts/check-api-auth.js fails the build if a route doesn't (see CLAUDE.md).
//
// Why this exists: pages talk to Supabase directly, where RLS and the database
// functions check every request. A route handler runs on the server, outside
// all of that, so without a check here anyone on the internet can call it —
// the AI comment routes did exactly that until this was added, spending the
// school's Anthropic credit for anyone who found the URL.
//
// The check is the same one the pages' RequireResource guard uses, but done
// where it can't be skipped:
//   1. the caller must send their Supabase access token (lib/apiFetch.js does);
//   2. Supabase Auth must confirm the token belongs to a real, current user
//      (getUser asks the Auth server, so a forged or signed-out token fails);
//   3. has_resource_access() must say that user may open one of the given
//      pages (admins always may; everyone else through role_permissions, as
//      set at /admin/permissions) — or, for ADMIN_ONLY, is_admin() must be
//      true, whatever role_permissions says.
// Anything unexpected — no token, an error from Supabase, missing config —
// is a refusal, never a pass.

import { createClient } from '@supabase/supabase-js';

// For actions that must stay admin-only even if someone later grants the
// page to another role at /admin/permissions (e.g. starting a backup).
export const ADMIN_ONLY = Symbol('admin only');

function deny(status, error) {
  return { denied: Response.json({ error }, { status }) };
}

// resourceKeys: one resource_key, or an array where access to any one is enough
// (e.g. a route shared by two pages), or ADMIN_ONLY.
export async function requireResource(request, resourceKeys) {
  const adminOnly = resourceKeys === ADMIN_ONLY;
  const keys = adminOnly ? [] : (Array.isArray(resourceKeys) ? resourceKeys : [resourceKeys]);
  if (!adminOnly && (keys.length === 0 || keys.some((k) => typeof k !== 'string' || !k))) {
    return deny(500, 'Route has no resource key to check access against.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return deny(500, 'Supabase is not configured on the server.');

  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return deny(401, 'Not signed in.');

  // A client acting as the caller, so has_resource_access() sees their auth.uid().
  // Never the service role key: that would bypass RLS for everything the route does.
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return deny(401, 'Not signed in.');

    if (adminOnly) {
      const { data: isAdmin, error } = await supabase.rpc('is_admin');
      if (!error && isAdmin === true) return { user, supabase };
      return deny(403, 'Only an admin can do this.');
    }

    for (const key of keys) {
      const { data: allowed, error } = await supabase.rpc('has_resource_access', { p_resource_key: key });
      if (!error && allowed === true) return { user, supabase };
    }
    return deny(403, "You don't have access to this.");
  } catch {
    return deny(401, 'Could not check your sign-in. Please try again.');
  }
}
