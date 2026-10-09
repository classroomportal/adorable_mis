-- 421: check "is this an admin?" once per query on profiles, not once per row
--
-- Why: 9 Oct 2026, importing the Week 3 Big ReLP gradebook from Adorable.net
-- (/results/import-gradebook) failed two batches with "canceling statement
-- due to statement timeout" (signed-in users have an 8-second limit).
--
-- The import upserts 50 marks at a time. On an upsert Postgres checks the
-- SELECT policies on results for every row, including the parent and
-- student ones, which join profiles. profiles' "Admins can read all
-- profiles" policy was a bare is_admin(), so for each of the ~1,400 profile
-- rows that wasn't the caller's own, is_admin() ran again: about 40 ms per
-- policy per mark, three times per mark. Measured as a signed-in user, one
-- batch of 50 took 6.5 s with the old policy (enough load and it passes 8 s)
-- and 1.0 s with this one; as postgres (no RLS) it takes 0.02 s.
--
-- Wrapping it as (select is_admin()) makes Postgres work it out once per
-- query. Who can read which profile is unchanged: admins all, everyone
-- else their own (the other policy). Every policy elsewhere that joins
-- profiles gets faster too.

set local formwork.change_note = 'Principal (direct)';

alter policy "Admins can read all profiles" on public.profiles
  using ((select public.is_admin()));
