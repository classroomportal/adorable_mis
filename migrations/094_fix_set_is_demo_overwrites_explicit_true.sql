-- Migration 094: stop set_is_demo() clobbering an explicit is_demo=true
--
-- set_is_demo() (attached to attendance, behaviour_events, certificates_awarded)
-- unconditionally did `new.is_demo := is_demo_account()`, ignoring whatever the
-- INSERT itself specified. reset_demo_data() (079) explicitly inserts these three
-- tables with is_demo = true, but it's called by pg_cron (080) or by hand outside
-- any authenticated session, so is_demo_account() (which reads auth.uid()) always
-- evaluates false in that context — every nightly reset was silently re-tagging
-- the reseeded demo behaviour events, attendance and certificates as real (false),
-- which is why they showed up mixed into every staff member's real dashboards and
-- alert counts (is_demo = is_demo_account() OR is_admin() matches false = false
-- for every real, non-demo user too, not just admins).
--
-- Fix: only recompute is_demo from the caller's session when the row wasn't
-- already explicitly inserted as true. Ordinary app inserts never set is_demo
-- themselves (column defaults to false), so this preserves today's behaviour for
-- real staff and the staff_demo login alike — it only stops overriding a
-- deliberate `true`.

create or replace function public.set_is_demo()
returns trigger
language plpgsql
security definer
as $function$
begin
  if new.is_demo is distinct from true then
    new.is_demo := is_demo_account();
  end if;
  return new;
end;
$function$;
