// The school calendar as a subscription feed, for a parent's phone or
// Google/Outlook calendar to fetch by itself and keep up to date
// (migration 274). Linked from /parent-portal/calendar as
// webcal://<host>/api/calendar-feed/<token>.ics.
//
// WHY THIS ROUTE HAS NO requireResource(): a calendar app fetching a feed
// can't sign in to Formwork, so this is the one route listed in
// PUBLIC_ROUTES in scripts/check-api-auth.js, with the principal's agreement
// (30 Sept 2026). The token in the URL is the check instead: each parent has
// their own random one, calendar_feed_events() returns nothing for a token it
// doesn't know or for a parent with no child still at the school, and the
// parent can replace it from the portal if the link is passed around.
//
// It reads through the anon key only, never the service role, so all it can
// ever return is what calendar_feed_events() gives out: school events from
// this academic year on, without the staff-only categories.

import { createClient } from '@supabase/supabase-js';
import { buildIcs, CALENDAR_CATEGORY_LABELS } from '../../../../lib/calendarExport';

export const dynamic = 'force-dynamic';

const TOKEN = /^[0-9a-f]{32}$/;

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request, { params }) {
  const token = String(params?.token || '').replace(/\.ics$/i, '').toLowerCase();
  if (!TOKEN.test(token)) return notFound();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new Response('Calendar unavailable', { status: 500 });

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('calendar_feed_events', { p_token: token });
  if (error) return new Response('Calendar unavailable', { status: 500 });
  if (!data || data.length === 0) return notFound();

  const ics = buildIcs(data, (c) => CALENDAR_CATEGORY_LABELS[c] || '', 'Adorable British College');
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="abc-school-calendar.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
