-- 214_close_authorisation_gaps.sql
--
-- A site-wide review (27 Sep 2026) of the question "if a student or parent
-- copies a request from the browser's Network tab and edits it, what stops
-- them?" Pages talk to Supabase directly, so the answer has to be the
-- database: RLS policies and SECURITY DEFINER functions that work out who
-- the caller is from auth.uid() (the signed-in token) and never from an ID
-- the browser sends.
--
-- Most of the site already holds up: every table has RLS, no student or
-- parent can write to grades, attendance, behaviour, fees or their own
-- profile link, and the functions they can call check auth.uid(). This
-- closes the gaps the review found:
--
-- 1. Functions anyone could call, even without signing in, that check
--    nothing. Worst is reset_demo_data(), left over from the removed demo
--    account: it inserts 15 fake "active" Year 8 students (plus demo
--    classes, results and attendance) into the live database. The demo
--    account and all its data are gone (checked: no is_demo rows in any
--    table, no demo login, staff, students or classes), so the function is
--    dropped; nothing in the app, the database or cron calls it. The others
--    are maintenance jobs with smaller effects, used only by the database's
--    own cron jobs (run as postgres) and triggers, so the API roles lose
--    EXECUTE on them.
--
-- 2. CAT4 and NGRT scores were readable by every signed-in user, so any
--    student or parent could list every student's scores. Now: staff, the
--    student themselves, and their parents, the same pattern as results
--    and target grades. Only the staff student page reads them today.
--
-- 3. A student filing a behaviour appeal could send status 'upheld' (and a
--    reviewer, date and notes) in the same request. The insert policy now
--    only accepts a new, unreviewed appeal; pastoral staff still decide it.
--
-- 4. Tuckshop and fees staff (not students) could spoof "who did it":
--    record_tuckshop_purchase, fulfill_tuckshop_preorder, the top-up and
--    fee functions all take p_created_by from the browser. A trigger now
--    stamps the signed-in user over whatever was sent. With no signed-in
--    user (a cron job) the value passed in is kept.
--
-- 5. Also staff-only: a sale with a negative quantity would add money to a
--    balance, and an unknown item gave a line with no price. Constraints now
--    reject both, however the row is written. No existing row breaks them.
--
-- 6. Tuckshop staff could set a preorder's status directly (e.g. mark it
--    fulfilled without charging). fulfill_tuckshop_preorder() and
--    save_tuckshop_order() are SECURITY DEFINER and don't need that policy,
--    and no page writes to tuckshop_preorders directly, so it is dropped.

-- 1. Unchecked functions: API roles can no longer call them ------------------

drop function if exists public.reset_demo_data();
revoke execute on function public.attach_backup_mode_guard(text) from public, anon, authenticated;
revoke execute on function public.capture_register_alerts() from public, anon, authenticated;
revoke execute on function public.recalc_invoice_status(bigint) from public, anon, authenticated;
revoke execute on function public.guard_new_tables() from public, anon, authenticated;

-- 2. CAT4 / NGRT: staff, the student, their parents ------------------------

drop policy if exists read_all_cat4 on public.cat4_results;
create policy staff_read_cat4 on public.cat4_results
  for select using (is_staff_or_admin());
create policy student_read_own_cat4 on public.cat4_results
  for select using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.student_id = cat4_results.student_id));
create policy parent_read_own_cat4 on public.cat4_results
  for select using (exists (
    select 1 from profiles p join student_parent sp on sp.parent_id = p.parent_id
    where p.id = auth.uid() and sp.student_id = cat4_results.student_id));

drop policy if exists read_all_ngrt on public.ngrt_results;
create policy staff_read_ngrt on public.ngrt_results
  for select using (is_staff_or_admin());
create policy student_read_own_ngrt on public.ngrt_results
  for select using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.student_id = ngrt_results.student_id));
create policy parent_read_own_ngrt on public.ngrt_results
  for select using (exists (
    select 1 from profiles p join student_parent sp on sp.parent_id = p.parent_id
    where p.id = auth.uid() and sp.student_id = ngrt_results.student_id));

-- 3. A student's appeal starts pending and unreviewed ------------------------

drop policy if exists student_insert_own_appeals on public.behaviour_appeals;
create policy student_insert_own_appeals on public.behaviour_appeals
  for insert with check (
    status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and resolution_notes is null
    and exists (
      select 1
      from profiles p
      join behaviour_events be on be.event_id = behaviour_appeals.event_id and be.type = 'negative'
      where p.id = auth.uid()
        and p.student_id = behaviour_appeals.student_id
        and p.student_id = be.student_id
    )
  );

-- 4. "Who did it" is the signed-in user, not what the browser says ---------

create or replace function public.stamp_actor()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- TG_ARGV[0] is the column to stamp. auth.uid() is null for cron jobs and
  -- other database-side callers, which keep the value they passed.
  if auth.uid() is not null then
    new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], auth.uid()));
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_actor() from public, anon, authenticated;

drop trigger if exists trg_stamp_created_by on public.tuckshop_purchases;
create trigger trg_stamp_created_by before insert on public.tuckshop_purchases
  for each row execute function public.stamp_actor('created_by');

drop trigger if exists trg_stamp_created_by on public.fee_charge_batches;
create trigger trg_stamp_created_by before insert on public.fee_charge_batches
  for each row execute function public.stamp_actor('created_by');

drop trigger if exists trg_stamp_recorded_by on public.fee_payments;
create trigger trg_stamp_recorded_by before insert on public.fee_payments
  for each row execute function public.stamp_actor('recorded_by');

-- 5. No negative or priceless tuckshop sale lines --------------------------

alter table public.tuckshop_purchase_items
  add constraint tuckshop_purchase_items_quantity_positive check (quantity >= 1),
  alter column unit_price set not null;

-- 6. Preorder status only changes through the tuckshop functions -----------

drop policy if exists "Tuckshop staff can update preorders" on public.tuckshop_preorders;
