-- Migration 273: the bursar can put a recorded payment onto a tuckshop balance.
--
-- Why: the principal asked (30 Sept 2026) for the bursar to have a tile to
-- add a confirmed top-up to a student's tuckshop balance. When a family pays
-- money in for tuckshop, the bursar already records it on /bursar/payments
-- (Record a Payment). That payment sits on the student's fee invoice but
-- does nothing to the tuckshop balance, which counts only 'Tuckshop' line
-- items minus purchases (get_tuckshop_balance()). Until now the only way to
-- raise a balance was /tuckshop/topup, which tops it up *to* a target
-- amount rather than by what was paid, and which the bursar no longer has.
--
-- add_tuckshop_top_up_from_payment() takes a payment the bursar has already
-- recorded and adds a "Tuck Shop Recharge" line for it (or for part of it,
-- when one transfer covered school fees as well) on the same invoice. The
-- balance goes up by that amount; the invoice total rises by the same amount
-- the payment already covers, so nothing is left unpaid (migration 189: "No
-- bills in the system should be unpaid").
--
-- The line records which payment it came from (invoice_line_items.
-- from_payment_id), and the function refuses to put more of a payment onto
-- the tuckshop than the payment was for, so the same payment can't be added
-- twice. A payment with tuckshop credit taken from it can't be deleted until
-- that credit line is removed (on delete restrict), so the credit can't
-- outlive the money behind it. It is not a fee_charge_batch, so it doesn't
-- appear with an "undo" on /bursar/audit. The line is logged in
-- change_history ('fees') by the table's existing trigger.
--
-- Bursar only (and admins, through user_has_staff_role()). Page:
-- /bursar/tuckshop-top-up, on the Tuckshop tab.

set local formwork.change_note = 'Principal (direct)';

alter table public.invoice_line_items
  add column from_payment_id bigint references public.fee_payments(id) on delete restrict;

create index invoice_line_items_from_payment_id_idx
  on public.invoice_line_items (from_payment_id) where from_payment_id is not null;

comment on column public.invoice_line_items.from_payment_id is
  'The fee payment this tuckshop credit was taken from (migration 273, add_tuckshop_top_up_from_payment()).';

create or replace function public.add_tuckshop_top_up_from_payment(p_payment_id bigint, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p fee_payments;
  v_student_id integer;
  v_item_id bigint;
  v_used numeric;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can add tuckshop top-ups.';
  end if;

  select * into p from fee_payments where id = p_payment_id for update;
  if p.id is null then
    raise exception 'Payment not found.';
  end if;

  select si.student_id into v_student_id
  from student_invoices si
  join students s on s.student_id = si.student_id
  where si.id = p.invoice_id and s.status = 'active';
  if v_student_id is null then
    raise exception 'That payment isn''t for a student currently at the school.';
  end if;

  select coalesce(sum(amount), 0) into v_used
  from invoice_line_items where from_payment_id = p.id;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount to add (more than zero).';
  end if;
  if v_used + p_amount > p.amount then
    raise exception 'Only NGN % of this payment is left to add to the tuckshop.', p.amount - v_used;
  end if;

  select id into v_item_id from fee_items where name = 'Tuck Shop Recharge' and category = 'Tuckshop';
  if v_item_id is null then
    raise exception 'No "Tuck Shop Recharge" fee item found.';
  end if;

  insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, added_by, from_payment_id)
  values (
    p.invoice_id, v_item_id,
    'Tuck shop top-up (paid ' || to_char(p.paid_date, 'DD Mon YYYY')
      || coalesce(', ' || nullif(btrim(p.reference), ''), '') || ')',
    p_amount, true, auth.uid(), p.id
  );

  return get_tuckshop_balance(v_student_id);
end;
$$;

revoke execute on function public.add_tuckshop_top_up_from_payment(bigint, numeric) from public, anon;
grant execute on function public.add_tuckshop_top_up_from_payment(bigint, numeric) to authenticated;

insert into resources (resource_key, label, section, sort_order) values
  ('/bursar/tuckshop-top-up', 'Add Paid Top-Up', 'Tuckshop', 81)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('bursar', '/bursar/tuckshop-top-up')
on conflict do nothing;
