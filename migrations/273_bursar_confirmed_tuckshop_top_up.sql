-- Migration 273: the bursar can add a paid tuckshop top-up.
--
-- Why: the principal asked (30 Sept 2026) for the bursar to have a tile to
-- add a confirmed top-up to a student's tuckshop balance, i.e. money a
-- family has already paid in for tuckshop.
--
-- The existing /tuckshop/topup can't do that. It tops a balance up *to* a
-- target by charging "Tuck Shop Recharge" on the student's fee invoice,
-- which is a bill to the parents: the invoice goes unpaid until someone
-- records a payment against it separately. That is how the 30 late joiners'
-- credit ended up as NGN 1.2m of unpaid bills (migration 189: "No bills in
-- the system should be unpaid").
--
-- record_tuckshop_top_up() does both halves in one transaction:
--   * a "Tuck Shop Recharge" line for the amount paid on the student's
--     invoice for the current fee term (tuckshop balances count Tuckshop
--     lines minus purchases, get_tuckshop_balance()), and
--   * a fee_payments row for the same amount on the same invoice, with the
--     method, reference and date the bursar gives,
-- so the balance goes up by exactly what was paid and the invoice's amount
-- owed doesn't change. It is not a fee_charge_batch, so it doesn't appear on
-- /bursar/audit with an "undo" that would remove the credit but leave the
-- payment behind. Both rows are logged in change_history ('fees') by their
-- existing triggers; the payment's recorded_by is stamped by stamp_actor().
--
-- Bursar only (and admins, through user_has_staff_role()), since it records
-- money received. Page: /bursar/tuckshop-top-up, on the Tuckshop tab.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.record_tuckshop_top_up(
  p_student_id integer,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_date date
)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_item_id bigint;
  v_term_id bigint;
  v_invoice_id bigint;
  v_reference text := nullif(btrim(p_reference), '');
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can record tuckshop top-ups.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount paid (more than zero).';
  end if;
  if p_method is null or p_method not in ('transfer', 'bankers_draft', 'zenith_app', 'cash', 'other') then
    raise exception 'Choose how it was paid.';
  end if;
  if p_paid_date is null or p_paid_date > school_today() then
    raise exception 'Give the date it was paid (not in the future).';
  end if;
  if not exists (select 1 from students where student_id = p_student_id and status = 'active') then
    raise exception 'Student not found, or no longer at the school.';
  end if;

  select id into v_item_id from fee_items where name = 'Tuck Shop Recharge' and category = 'Tuckshop';
  if v_item_id is null then
    raise exception 'No "Tuck Shop Recharge" fee item found.';
  end if;

  select id into v_term_id from fee_terms where is_current order by id desc limit 1;
  if v_term_id is null then
    raise exception 'No current fee term is set.';
  end if;

  insert into student_invoices (student_id, term_id)
  values (p_student_id, v_term_id)
  on conflict (student_id, term_id) do nothing;

  select id into v_invoice_id from student_invoices
  where student_id = p_student_id and term_id = v_term_id;

  insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, added_by)
  values (
    v_invoice_id, v_item_id,
    'Tuck shop top-up (paid' || coalesce(', ' || v_reference, '') || ')',
    p_amount, true, auth.uid()
  );

  insert into fee_payments (invoice_id, amount, method, reference, paid_date)
  values (v_invoice_id, p_amount, p_method, coalesce(v_reference, 'Tuck shop top-up'), p_paid_date);

  return get_tuckshop_balance(p_student_id);
end;
$$;

revoke execute on function public.record_tuckshop_top_up(integer, numeric, text, text, date) from public, anon;
grant execute on function public.record_tuckshop_top_up(integer, numeric, text, text, date) to authenticated;

insert into resources (resource_key, label, section, sort_order) values
  ('/bursar/tuckshop-top-up', 'Add Paid Top-Up', 'Tuckshop', 81)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('bursar', '/bursar/tuckshop-top-up')
on conflict do nothing;
