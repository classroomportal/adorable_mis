-- Migration 101: close the remaining live findings from the 18 Sept 2026 board
-- security review (Supabase advisor + manual audit)
--
-- 1) All four SECURITY DEFINER views (student_summary, attendance_today,
--    registers_not_done, message_read_status) had SELECT granted to `anon` —
--    meaning an unauthenticated visitor could pull real student names,
--    behaviour totals, exam averages and parent phone numbers
--    (student_summary), today's attendance (attendance_today), and every
--    message's read-receipts with recipient names/emails (message_read_status)
--    with no login at all. Revoked outright; none of these should ever be
--    reachable by anon.
--
-- 2) student_summary, attendance_today and registers_not_done are switched to
--    security_invoker so Postgres enforces the real per-row RLS on the
--    underlying tables for whoever is actually asking, instead of the view
--    running as its owner and bypassing it. For student_summary this also
--    closes a real over-exposure that predates this review: parent contact
--    phone numbers are only meant to be visible to pastoral/SMT/admin (see
--    the `parents`/`student_parent` RLS policies), but the view's
--    SECURITY DEFINER bypass was showing them to every staff role.
--
-- 3) message_read_status can't take the same simple fix — message_recipients'
--    own RLS only lets someone see their own row, and a message's sender
--    legitimately needs to see every recipient's read receipt. Instead it
--    keeps its elevated-privilege model but gets the explicit authorization
--    check it was completely missing (matching the same roles send_message()
--    already restricts sending to, per migration 091), rather than the "no
--    filter at all" it shipped with.
--
-- 4) Every SECURITY DEFINER/trigger function still holding an `anon` EXECUTE
--    grant has it revoked. `authenticated` grants are left alone — the
--    functions' own internal role checks (is_admin()/user_has_staff_role())
--    are what actually gate a logged-in caller, same as before — but there is
--    no legitimate reason for a logged-out visitor to be able to invoke any
--    of these over the public REST RPC surface at all.
--
-- 5) Every flagged function gets an explicit, immutable search_path — routine
--    hardening against search-path hijacking, no behavior change.

-- --- 1 & 2: views ---

revoke select on public.student_summary, public.attendance_today, public.registers_not_done, public.message_read_status from anon;

alter view public.student_summary set (security_invoker = true);
alter view public.attendance_today set (security_invoker = true);
alter view public.registers_not_done set (security_invoker = true);

-- --- 3: message_read_status gets an explicit authorization check ---

create or replace view public.message_read_status as
select mr.message_id,
    mr.profile_id,
    mr.read_at,
    coalesce(pr.email, par.email, s.student_email) as recipient_email,
    coalesce((stf.first_name || ' ' || stf.last_name), (s.first_name || ' ' || s.last_name), (par.first_name || ' ' || par.last_name)) as recipient_name
from message_recipients mr
join profiles pr on pr.id = mr.profile_id
left join staff stf on stf.staff_id = pr.staff_id
left join students s on s.student_id = pr.student_id
left join parents par on par.parent_id = pr.parent_id
where is_admin() or exists (
  select 1 from messages m
  where m.id = mr.message_id
    and (m.sent_by = auth.uid() or user_has_staff_role(array['smt', 'pastoral', 'school_office']))
);

-- --- 4: revoke anon EXECUTE on every function that still had it ---

REVOKE EXECUTE ON FUNCTION public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_set_student_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_student_tuckshop(p_student_id integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.capture_register_alerts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_parent_logins(only_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_staff_logins(only_email text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_student_logins(only_upn text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_next_upn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tuckshop_balance(p_student_id integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tuckshop_balances() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_negative_behaviour() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_resource_access(p_resource_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_staff_role(role_names text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_assessment_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_demo_account() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_pastoral_or_smt() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_profile_to_staff() FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_message_read(p_message_id bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_subjects(from_id integer, into_id integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_department_scope() FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_house_scope() FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_parent_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_pastoral_on_negative_behaviour() FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_status(p_invoice_id bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_all_parent_passwords() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_demo_data() FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_message_recipients(p_target_type text, p_target_value text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_people(p_query text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_is_demo() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_student_class_block_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_term_published(p_term_id bigint, p_published boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.top_up_tuckshop_balance_for_group(p_target_type text, p_target_value text, p_term_id bigint, p_target_balance numeric, p_created_by uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.touch_sgb_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_recalc_invoice_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.undo_fee_charge_batch(p_batch_id bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_staff_role(role_names text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_event_on_upheld_appeal() FROM anon;

-- --- 5: pin search_path on every flagged function ---

ALTER FUNCTION public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.apply_student_discount(p_student_discount_id bigint, p_term_id bigint, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_set_student_status() SET search_path = public, pg_temp;
ALTER FUNCTION public.can_view_student_tuckshop(p_student_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.capture_register_alerts() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_parent_logins(only_email text) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_staff_logins(only_email text) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_student_logins(only_upn text) SET search_path = public, pg_temp;
ALTER FUNCTION public.fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_next_upn() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_tuckshop_balance(p_student_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_tuckshop_balances() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_negative_behaviour() SET search_path = public, pg_temp;
ALTER FUNCTION public.has_staff_role(role_names text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_assessment_manager() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_demo_account() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_pastoral_or_smt() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_staff_or_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.link_profile_to_staff() SET search_path = public, pg_temp;
ALTER FUNCTION public.mark_message_read(p_message_id bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.merge_subjects(from_id integer, into_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.my_house_scope() SET search_path = public, pg_temp;
ALTER FUNCTION public.my_parent_ids() SET search_path = public, pg_temp;
ALTER FUNCTION public.notify_pastoral_on_negative_behaviour() SET search_path = public, pg_temp;
ALTER FUNCTION public.recalc_invoice_status(p_invoice_id bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_all_parent_passwords() SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_demo_data() SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_message_recipients(p_target_type text, p_target_value text) SET search_path = public, pg_temp;
ALTER FUNCTION public.search_people(p_query text) SET search_path = public, pg_temp;
ALTER FUNCTION public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text) SET search_path = public, pg_temp;
ALTER FUNCTION public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text) SET search_path = public, pg_temp;
ALTER FUNCTION public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_is_demo() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_student_class_block_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_term_published(p_term_id bigint, p_published boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.top_up_tuckshop_balance(p_student_id integer, p_term_id bigint, p_target_balance numeric, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.top_up_tuckshop_balance_for_group(p_target_type text, p_target_value text, p_term_id bigint, p_target_balance numeric, p_created_by uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_sgb_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_recalc_invoice_status() SET search_path = public, pg_temp;
ALTER FUNCTION public.undo_fee_charge_batch(p_batch_id bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_staff_role(role_names text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.void_event_on_upheld_appeal() SET search_path = public, pg_temp;
