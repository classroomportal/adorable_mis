-- Migration 102: the training account can currently see, and partly write, real fee data
--
-- Every fees/invoicing table (fee_charge_batches, fee_payment_plans,
-- fee_payment_plan_installments, fee_payments, invoice_line_items,
-- student_discounts, student_invoices) has zero is_demo concept, and their
-- staff-facing RLS policies check only user_has_staff_role(['bursar','smt']).
-- The one demo staff persona (staff_id 900001, migration 078) is seeded with
-- the 'smt' role for training realism -- which happens to be exactly the role
-- these policies trust. The result: logging in as the training account and
-- opening the fees/bursar area shows real student invoices, real payments
-- (amount, method, reference), real discounts and real payment plans, for
-- real families, with no demo/real distinction at all.
--
-- Unlike attendance/behaviour/etc., the fees module was never built with a
-- sandboxed demo dataset to fall back to -- so the fix here follows the same
-- precedent as Communication (migration 081/091): block the training account
-- outright rather than half-build a fake ledger. Fee/term/discount-type
-- *catalog* tables (fee_items, fee_terms, fee_discount_types -- shared
-- reference data, no student or money tied to a row) are left untouched, same
-- as attendance_codes/terms elsewhere in the schema.
--
-- Also closes a write-side version of the same gap: apply_fee_charge_batch(),
-- undo_fee_charge_batch() and set_term_published() check only for the 'smt'/
-- 'bursar' role (added in migration 100, which fixed the "no check at all"
-- issue but not this one) -- since the demo persona holds 'smt', it could
-- already call all three directly and apply real charges, delete real charge
-- batches, or publish/unpublish a real fee term to real parents. These get
-- the same is_demo_account() block send_message() already has.

drop policy if exists "Fees staff can read charge batches" on fee_charge_batches;
create policy "Fees staff can read charge batches" on fee_charge_batches
  for select using (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account());

drop policy if exists "Fee staff can read payment plan installments" on fee_payment_plan_installments;
create policy "Fee staff can read payment plan installments" on fee_payment_plan_installments
  for select using (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account());

drop policy if exists "Fee staff can read payment plans" on fee_payment_plans;
create policy "Fee staff can read payment plans" on fee_payment_plans
  for select using (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account());

drop policy if exists "Fees staff and parents can read relevant payments" on fee_payments;
create policy "Fees staff and parents can read relevant payments" on fee_payments
  for select using (
    (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account())
    or (invoice_id in (
      select si.id from student_invoices si
      join student_parent sp on sp.student_id = si.student_id
      join fee_terms ft on ft.id = si.term_id
      where sp.parent_id in (select my_parent_ids()) and ft.published_to_parents = true
    ))
  );

drop policy if exists "Fees staff and parents can read relevant line items" on invoice_line_items;
create policy "Fees staff and parents can read relevant line items" on invoice_line_items
  for select using (
    (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account())
    or (invoice_id in (
      select si.id from student_invoices si
      join student_parent sp on sp.student_id = si.student_id
      join fee_terms ft on ft.id = si.term_id
      where sp.parent_id in (select my_parent_ids()) and ft.published_to_parents = true
    ))
  );

drop policy if exists "Fee staff can read student discounts" on student_discounts;
create policy "Fee staff can read student discounts" on student_discounts
  for select using (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account());

drop policy if exists "Fees staff and parents can read relevant invoices" on student_invoices;
create policy "Fees staff and parents can read relevant invoices" on student_invoices
  for select using (
    (user_has_staff_role(array['bursar', 'smt']) and not is_demo_account())
    or (
      student_id in (select sp.student_id from student_parent sp where sp.parent_id in (select my_parent_ids()))
      and term_id in (select id from fee_terms where published_to_parents = true)
    )
  );

create or replace function public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)
returns table(batch_id bigint, students_charged integer)
language plpgsql
security definer
as $function$
declare
  v_batch_id bigint;
  v_student_id integer;
  v_invoice_id bigint;
  v_count integer := 0;
begin
  if is_demo_account() then
    raise exception 'Fee charges are disabled for the training account.';
  end if;

  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can apply fee charges';
  end if;

  if p_target_type not in ('individual', 'form_class', 'year_group', 'all') then
    raise exception 'Invalid target_type: %', p_target_type;
  end if;

  insert into fee_charge_batches (fee_item_id, term_id, description, amount, target_type, target_value, created_by)
  values (p_fee_item_id, p_term_id, p_description, p_amount, p_target_type, p_target_value, p_created_by)
  returning id into v_batch_id;

  for v_student_id in
    select s.student_id from students s
    where s.status = 'active'
      and (
        (p_target_type = 'individual' and s.student_id = p_target_value::integer)
        or (p_target_type = 'form_class' and s.form_class = p_target_value)
        or (p_target_type = 'year_group' and s.year_group = p_target_value::integer)
        or (p_target_type = 'all')
      )
  loop
    insert into student_invoices (student_id, term_id)
    values (v_student_id, p_term_id)
    on conflict (student_id, term_id) do nothing;

    select id into v_invoice_id from student_invoices
    where student_id = v_student_id and term_id = p_term_id;

    insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, batch_id, added_by)
    values (v_invoice_id, p_fee_item_id, p_description, p_amount, true, v_batch_id, p_created_by);

    v_count := v_count + 1;
  end loop;

  return query select v_batch_id, v_count;
end;
$function$;

create or replace function public.undo_fee_charge_batch(p_batch_id bigint)
returns integer
language plpgsql
security definer
as $function$
declare
  v_count integer;
begin
  if is_demo_account() then
    raise exception 'Fee charges are disabled for the training account.';
  end if;

  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can undo fee charge batches';
  end if;

  delete from invoice_line_items where batch_id = p_batch_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.set_term_published(p_term_id bigint, p_published boolean)
returns void
language plpgsql
security definer
as $function$
begin
  if is_demo_account() then
    raise exception 'Publishing fee terms is disabled for the training account.';
  end if;

  if not user_has_staff_role(array['smt']) then
    raise exception 'Only admin or SMT can publish fees to parents';
  end if;

  update fee_terms
  set published_to_parents = p_published,
      published_at = case when p_published then now() else null end,
      published_by = case when p_published then auth.uid() else null end
  where id = p_term_id;
end;
$function$;
