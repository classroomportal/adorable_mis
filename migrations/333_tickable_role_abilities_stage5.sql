-- Migration 333: tickable role abilities, stage 5, the last (Fees).
--
-- Why (the principal, 3 Oct 2026): stage 5 of docs/role-abilities-design.md,
-- generated from the live rules the same way as stage 4 (migration 332). 12
-- fee tables. An action becomes ticks only where every rule granting it
-- names just roles; otherwise the rules stay and the action is padlocked
-- with the reason. That keeps fixed:
--   * who sees invoices, charges, payments, fee items and fee terms: those
--     rules also let parents see their own children's, once a term is
--     published;
--   * everything about fee prices: price changes and year-group prices are
--     read by those who can propose prices and the two approvers, and are
--     written only through the proposal and approval functions (the
--     principal's two-person rule, migration 259; padlocked since 329).
-- Editing a fee item is a tick (the bursar today), but its price can still
-- never be written from the app: guard_fee_prices() and the locked-price
-- trigger on invoice lines (migrations 259–261) are untouched, as are the
-- invoice-status and Change History triggers.
--
-- Checked before and after for all 21 roles on every table and action: no
-- role gains or loses anything.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('student_invoices', 'view', 'The bursar and SMT; parents see their own children''s once the term is published (fixed rule)'),
  ('student_invoices', 'edit', 'Never done from the app'),
  ('student_invoices', 'delete', 'Never done from the app'),
  ('invoice_line_items', 'view', 'The bursar and SMT; parents see their own children''s once the term is published (fixed rule)'),
  ('invoice_line_items', 'edit', 'Never done from the app'),
  ('fee_payments', 'view', 'The bursar and SMT; parents see their own children''s once the term is published (fixed rule)'),
  ('fee_payments', 'edit', 'Never done from the app'),
  ('fee_payments', 'delete', 'Never done from the app'),
  ('fee_items', 'view', 'The bursar and SMT, and parents (fixed rule)'),
  ('fee_items', 'delete', 'Never done from the app'),
  ('fee_item_year_prices', 'view', 'Those who can propose fee prices and the two approvers (the principal''s two-person approval, fixed)'),
  ('fee_price_changes', 'view', 'Those who can propose fee prices and the two approvers (the principal''s two-person approval, fixed)'),
  ('fee_terms', 'view', 'The bursar, SMT and the tuckshop, and parents (fixed rule)'),
  ('fee_terms', 'add', 'Never done from the app'),
  ('fee_terms', 'edit', 'Never done from the app'),
  ('fee_terms', 'delete', 'Never done from the app'),
  ('fee_charge_batches', 'edit', 'Never done from the app'),
  ('fee_charge_batches', 'delete', 'Never done from the app');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('student_invoices', 5), ('invoice_line_items', 5), ('fee_payments', 5), ('fee_items', 5), ('fee_item_year_prices', 5), ('fee_price_changes', 5), ('fee_discount_types', 5), ('student_discounts', 5), ('fee_terms', 5), ('fee_charge_batches', 5), ('fee_payment_plans', 5), ('fee_payment_plan_installments', 5);

insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, t.action
from (values
  ('fee_charge_batches', 'add', array['admin', 'bursar']),
  ('fee_charge_batches', 'view', array['admin', 'bursar', 'smt']),
  ('fee_discount_types', 'add', array['admin', 'bursar']),
  ('fee_discount_types', 'delete', array['admin', 'bursar']),
  ('fee_discount_types', 'edit', array['admin', 'bursar']),
  ('fee_discount_types', 'view', array['admin', 'bursar', 'smt']),
  ('fee_items', 'add', array['admin', 'bursar']),
  ('fee_items', 'edit', array['admin', 'bursar']),
  ('fee_payment_plan_installments', 'add', array['admin', 'bursar']),
  ('fee_payment_plan_installments', 'delete', array['admin', 'bursar']),
  ('fee_payment_plan_installments', 'edit', array['admin', 'bursar']),
  ('fee_payment_plan_installments', 'view', array['admin', 'bursar', 'smt']),
  ('fee_payment_plans', 'add', array['admin', 'bursar']),
  ('fee_payment_plans', 'delete', array['admin', 'bursar']),
  ('fee_payment_plans', 'edit', array['admin', 'bursar']),
  ('fee_payment_plans', 'view', array['admin', 'bursar', 'smt']),
  ('fee_payments', 'add', array['admin', 'bursar']),
  ('invoice_line_items', 'add', array['admin', 'bursar']),
  ('invoice_line_items', 'delete', array['admin', 'bursar']),
  ('student_discounts', 'add', array['admin', 'bursar']),
  ('student_discounts', 'delete', array['admin', 'bursar']),
  ('student_discounts', 'edit', array['admin', 'bursar']),
  ('student_discounts', 'view', array['admin', 'bursar', 'smt']),
  ('student_invoices', 'add', array['admin', 'bursar'])
) t(table_name, action, roles)
cross join lateral unnest(t.roles) u(role_name)
join roles r on r.role_name = u.role_name;

-- ---------------------------------------------------------------- policies

-- Rules that only name roles; replaced by the ability policies below.
drop policy if exists "Fees staff can insert invoices" on public.student_invoices;
drop policy if exists "Fees staff can delete line items" on public.invoice_line_items;
drop policy if exists "Fees staff can insert line items" on public.invoice_line_items;
drop policy if exists "Fees staff can insert payments" on public.fee_payments;
drop policy if exists "Fee items updatable by bursar" on public.fee_items;
drop policy if exists "Fee items writable by bursar" on public.fee_items;
drop policy if exists "Fee staff can read discount types" on public.fee_discount_types;
drop policy if exists "Fee staff can write discount types" on public.fee_discount_types;
drop policy if exists "Fee staff can read student discounts" on public.student_discounts;
drop policy if exists "Fee staff can write student discounts" on public.student_discounts;
drop policy if exists "Fees staff can insert charge batches" on public.fee_charge_batches;
drop policy if exists "Fees staff can read charge batches" on public.fee_charge_batches;
drop policy if exists "Fee staff can read payment plans" on public.fee_payment_plans;
drop policy if exists "Fee staff can write payment plans" on public.fee_payment_plans;
drop policy if exists "Fee staff can read payment plan installments" on public.fee_payment_plan_installments;
drop policy if exists "Fee staff can write payment plan installments" on public.fee_payment_plan_installments;

-- One ability policy per action that isn't padlocked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'student_invoices', 'invoice_line_items', 'fee_payments', 'fee_items',
    'fee_item_year_prices', 'fee_price_changes', 'fee_discount_types', 'student_discounts',
    'fee_terms', 'fee_charge_batches', 'fee_payment_plans', 'fee_payment_plan_installments']
  loop
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'view') then
      execute format('create policy ability_view on public.%I for select to authenticated using ((select has_ability(%L, ''view'')))', t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'add') then
      execute format('create policy ability_add on public.%I for insert to authenticated with check ((select has_ability(%L, ''add'')))', t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'edit') then
      execute format('create policy ability_edit on public.%I for update to authenticated using ((select has_ability(%L, ''edit''))) with check ((select has_ability(%L, ''edit'')))', t, t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'delete') then
      execute format('create policy ability_delete on public.%I for delete to authenticated using ((select has_ability(%L, ''delete'')))', t, t);
    end if;
  end loop;
end;
$$;
