import { supabase } from './supabaseClient';

// POST JSON to one of our own app/api routes as the signed-in user. Sends the
// Supabase access token, which every route checks with requireResource()
// (lib/serverAuth.js); a plain fetch() without it is refused with 401.
// getSession() refreshes the token first if it has expired.
export async function apiPost(url, body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
