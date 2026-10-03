-- Migration 338: cost centres, and fee income by fund (budgets phase 1).
--
-- Why: the principal, 2-3 Oct 2026 (design and decisions in
-- docs/finance-budget-design.md). Tuition goes into a general fund that is
-- shared out in advance across cost centres (Staffing, Power, Food,
-- Maintenance, ...). Direct charges (swimming, sports, medical, ICT, exam
-- entry) are ring-fenced: what is collected for them is spent on them.
-- Damages go to Maintenance; discounts reduce tuition only; tuck shop money
-- is the students' own and stays outside the budget. Overspending will be
-- met by a release from Contingency (phase 3). This phase only works out
-- where the money collected belongs; nothing is allocated or spent yet.
--
-- How it works:
--   * cost_centres: one row per fund, of five kinds. Exactly one
--     general_pool ("General fund"), one contingency and one held ("Tuck
--     shop, held for students"); any number of allocated and ring_fenced.
--     Added, renamed and archived by the principal or the college secretary
--     only (holds_staff_role(), so admin is not enough). Never deleted: the
--     principal's rule for finance (3 Oct 2026) is that nothing is deleted,
--     things are cancelled or archived with who did it recorded. Archiving
--     stamps archived_at / archived_by from auth.uid().
--   * fee_items.cost_centre_id: which fund an item's money goes to. Set only
--     through set_fee_item_cost_centre() (principal or college secretary);
--     guard_fee_item_cost_centre() refuses it from the app otherwise. Once an
--     item has been charged its fund can't change (create a new item): the
--     money already collected for it stays where it was counted, and moving
--     the item would make its charges and its payments disagree.
--   * fee_payment_allocations: how each payment is shared between funds,
--     worked out when the payment is recorded and stored, so later charges
--     don't move money collected earlier. The principal's rule: pro rata.
--       1. A line made from this payment (a tuck shop top-up,
--          invoice_line_items.from_payment_id) is paid by it first
--          ('earmarked').
--       2. The rest is shared across the invoice's funds in proportion to
--          what each is still owed, net of discounts and adjustments
--          ('pro_rata'). Pennies from rounding go to the largest share.
--       3. Anything more than the invoice owes is credit in the general fund
--          ('credit'). When a charge is later added to that invoice, the
--          credit is applied to it the same way, so paying before being
--          charged still reaches the right fund.
--     Lines on an item with no fund yet are counted as "not assigned" for
--     that item, and move to the fund when the item is given one. Rows are
--     written only by triggers; the app can read them, never write them.
--   * finance_fund_summary(year) and finance_fee_item_funds(): charged and
--     collected per fund for an academic year, and which items feed which
--     fund, for the new page /finance/budget. Totals only; no student's
--     name or payment.
--   * Existing payments (all tuck shop so far, 2 Oct 2026) are split once
--     at the end, in the order they were recorded.
--   * Cost centres are logged in change_history under a new area,
--     'finance'; fee items stay under 'fees'.
--   * While it is being built, only the principal sees any of it (the
--     principal, 3 Oct 2026: "I want to be the only person seeing the Budget
--     tile while we develop"). can_view_budget() is the one check: it is
--     holds_staff_role('principal') for now, so being admin is not enough.
--     When the budget opens to the bursar, SMT and the college secretary, a
--     later migration changes can_view_budget() to
--     has_resource_access('/finance/budget') and grants them the page.

set local formwork.change_note = 'Principal (direct)';

-- 1. Cost centres ------------------------------------------------------------

create table public.cost_centres (
  id bigint generated always as identity primary key,
  name text not null,
  kind text not null check (kind in ('general_pool', 'contingency', 'allocated', 'ring_fenced', 'held')),
  description text,
  direct_spend boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid,
  -- Nothing in finance is deleted (the principal, 3 Oct 2026): a cost
  -- centre is archived, and who did it and when are kept.
  archived_at timestamptz,
  archived_by uuid
);
create unique index cost_centres_name_unique on public.cost_centres (lower(btrim(name)));
-- One general fund, one contingency, one tuck shop fund.
create unique index cost_centres_one_special on public.cost_centres (kind)
  where kind in ('general_pool', 'contingency', 'held');

alter table public.cost_centres enable row level security;
grant select, insert, update on public.cost_centres to authenticated;

create or replace function public.is_budget_approver()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select holds_staff_role('principal') or holds_staff_role('college_secretary');
$$;

-- Who can see the budget. The principal only, while it is being built.
create or replace function public.can_view_budget()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select holds_staff_role('principal');
$$;

create policy cost_centres_read on public.cost_centres for select to authenticated
  using (can_view_budget());
create policy cost_centres_insert on public.cost_centres for insert to authenticated
  with check (is_budget_approver());
create policy cost_centres_update on public.cost_centres for update to authenticated
  using (is_budget_approver()) with check (is_budget_approver());

-- The three special funds keep their kind and stay active; a fund that fee
-- items still point at can't be archived; direct_spend is a budget decision
-- (phase 4, two-person) and can't be set here.
create or replace function public.cost_centres_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kind not in ('allocated', 'ring_fenced') then
      raise exception 'Only allocated and ring-fenced cost centres can be added here.';
    end if;
    if new.direct_spend then
      raise exception 'Spending without a requisition is set through an approved budget change, not here.';
    end if;
    new.active := true;
    new.archived_at := null;
    new.archived_by := null;
    return new;
  end if;
  -- Who archived it and when are stamped here, never taken from the request.
  if old.active and not new.active then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif not old.active and new.active then
    new.archived_at := null;
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  if new.direct_spend is distinct from old.direct_spend then
    raise exception 'Spending without a requisition is set through an approved budget change, not here.';
  end if;
  if old.kind in ('general_pool', 'contingency', 'held') then
    if new.kind <> old.kind then
      raise exception '% can''t be changed to another kind of fund.', old.name;
    end if;
    if not new.active then
      raise exception '% can''t be archived.', old.name;
    end if;
  elsif new.kind in ('general_pool', 'contingency', 'held') then
    raise exception 'Only allocated and ring-fenced cost centres can be added or changed here.';
  end if;
  if old.active and not new.active
     and exists (select 1 from fee_items where cost_centre_id = old.id) then
    raise exception 'Fee items still pay into %. Give them another fund first.', old.name;
  end if;
  return new;
end;
$$;
revoke execute on function public.cost_centres_guard() from public, anon, authenticated;

create trigger trg_cost_centres_guard before insert or update on public.cost_centres
  for each row execute function public.cost_centres_guard();
create trigger trg_stamp_created_by before insert on public.cost_centres
  for each row execute function public.stamp_actor('created_by');

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups', 'students', 'reading_ages', 'finance'));

create trigger trg_log_change after insert or update or delete on public.cost_centres
  for each row execute function public.log_change('finance', 'id');

insert into public.cost_centres (name, kind, description, sort_order) values
  ('General fund', 'general_pool', 'Tuition, less discounts. Shared out in advance across the allocated cost centres.', 1),
  ('Contingency', 'contingency', 'Set aside in the budget. Released to a cost centre that would otherwise overspend.', 2),
  ('Staffing', 'allocated', null, 10),
  ('Power', 'allocated', null, 11),
  ('Food', 'allocated', null, 12),
  ('Maintenance', 'allocated', 'Also receives Damages & Surcharge.', 13),
  ('Swimming', 'ring_fenced', null, 30),
  ('Sports', 'ring_fenced', 'Sports Academy and Taekwondo.', 31),
  ('Medical', 'ring_fenced', null, 32),
  ('ICT', 'ring_fenced', null, 33),
  ('Exam entries', 'ring_fenced', 'Billed to parents, paid out to the British Council.', 34),
  ('Tuck shop, held for students', 'held', 'Students'' own money. Outside the budget.', 90);

-- 2. Which fund each fee item pays into --------------------------------------

alter table public.fee_items add column cost_centre_id bigint references public.cost_centres(id);

create or replace function public.guard_fee_item_cost_centre()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user = 'authenticated'
     and ((tg_op = 'INSERT' and new.cost_centre_id is not null)
       or (tg_op = 'UPDATE' and new.cost_centre_id is distinct from old.cost_centre_id)) then
    raise exception 'A fee item''s fund is set by the principal or the college secretary on the Budget page.';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_fee_item_cost_centre() from public, anon, authenticated;

create trigger trg_guard_fee_item_cost_centre before insert or update on public.fee_items
  for each row execute function public.guard_fee_item_cost_centre();

-- Seed: by category, and by name for the activities.
update public.fee_items fi set cost_centre_id = cc.id
from public.cost_centres cc
where cc.name = case
  when lower(btrim(fi.category)) in ('tuition', 'discount') then 'General fund'
  when lower(btrim(fi.category)) = 'tuckshop' then 'Tuck shop, held for students'
  when lower(btrim(fi.category)) = 'damages' then 'Maintenance'
  when lower(btrim(fi.category)) = 'medical' then 'Medical'
  when lower(btrim(fi.category)) = 'technology' then 'ICT'
  when lower(btrim(fi.name)) = 'swimming' then 'Swimming'
  when lower(btrim(fi.name)) in ('sports academy', 'taekwondo') then 'Sports'
end;

-- 3. How each payment is shared ---------------------------------------------

create table public.fee_payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references public.fee_payments(id) on delete cascade,
  -- Null only while the item has no fund ("not assigned"); then fee_item_id
  -- says which item. When the item is given a fund, the row moves to it.
  cost_centre_id bigint references public.cost_centres(id),
  fee_item_id bigint references public.fee_items(id),
  amount numeric(12,2) not null,
  basis text not null check (basis in ('earmarked', 'pro_rata', 'credit')),
  created_at timestamptz not null default now(),
  check (cost_centre_id is null or fee_item_id is null)
);
create index fee_payment_allocations_payment on public.fee_payment_allocations (payment_id);
create index fee_payment_allocations_cost_centre on public.fee_payment_allocations (cost_centre_id);

alter table public.fee_payment_allocations enable row level security;
grant select on public.fee_payment_allocations to authenticated;
create policy fee_payment_allocations_read on public.fee_payment_allocations for select to authenticated
  using (can_view_budget());

-- What an invoice still owes each fund (or each unassigned item), net of
-- discounts and adjustments, after the pro-rata shares already placed.
-- Lines made from a payment are left out: that payment covers them.
create or replace function public.fee_invoice_owed(p_invoice_id bigint)
returns table (cc bigint, item bigint, owed numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with charged as (
    select fi.cost_centre_id as cc,
           case when fi.cost_centre_id is null then l.fee_item_id end as item,
           sum(l.amount) as amt
    from invoice_line_items l
    left join fee_items fi on fi.id = l.fee_item_id
    where l.invoice_id = p_invoice_id and l.from_payment_id is null
    group by 1, 2
  ), paid as (
    select a.cost_centre_id as cc, a.fee_item_id as item, sum(a.amount) as amt
    from fee_payment_allocations a
    join fee_payments p on p.id = a.payment_id
    where p.invoice_id = p_invoice_id and a.basis = 'pro_rata'
    group by 1, 2
  )
  select c.cc, c.item, c.amt - coalesce(p.amt, 0)
  from charged c
  left join paid p on p.cc is not distinct from c.cc and p.item is not distinct from c.item
  where c.amt - coalesce(p.amt, 0) > 0;
$$;

-- Shares up to p_amount of a payment across what its invoice still owes,
-- pro rata, and returns how much it placed (never more than is owed).
-- Pennies from rounding go to the largest share.
create or replace function public.fee_payment_spread(p_payment_id bigint, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_invoice bigint;
  v_owed numeric;
  v_portion numeric;
  v_placed numeric;
  v_first bigint;
  v_top bigint;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;
  select invoice_id into v_invoice from fee_payments where id = p_payment_id;
  select coalesce(sum(owed), 0) into v_owed from fee_invoice_owed(v_invoice);
  if v_owed <= 0 then
    return 0;
  end if;
  v_portion := least(p_amount, v_owed);
  select coalesce(max(id), 0) into v_first from fee_payment_allocations;

  insert into fee_payment_allocations (payment_id, cost_centre_id, fee_item_id, amount, basis)
  select p_payment_id, o.cc, o.item, round(v_portion * o.owed / v_owed, 2), 'pro_rata'
  from fee_invoice_owed(v_invoice) o
  where round(v_portion * o.owed / v_owed, 2) <> 0;

  select coalesce(sum(amount), 0) into v_placed
  from fee_payment_allocations where payment_id = p_payment_id and id > v_first;
  if v_placed <> v_portion then
    select id into v_top from fee_payment_allocations
    where payment_id = p_payment_id and id > v_first
    order by amount desc, id limit 1;
    if v_top is null then
      insert into fee_payment_allocations (payment_id, cost_centre_id, fee_item_id, amount, basis)
      select p_payment_id, o.cc, o.item, v_portion, 'pro_rata'
      from fee_invoice_owed(v_invoice) o order by o.owed desc limit 1;
    else
      update fee_payment_allocations set amount = amount + (v_portion - v_placed) where id = v_top;
    end if;
  end if;
  return v_portion;
end;
$$;

-- Works out one payment's shares from scratch.
create or replace function public.allocate_fee_payment(p_payment_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_amount numeric;
  v_general bigint;
  v_earmarked numeric;
  v_scale numeric;
  v_rest numeric;
begin
  delete from fee_payment_allocations where payment_id = p_payment_id;
  select amount into v_amount from fee_payments where id = p_payment_id;
  if v_amount is null then
    return;
  end if;
  select id into v_general from cost_centres where kind = 'general_pool';

  -- 1. Lines made from this payment are paid by it first.
  select coalesce(sum(amount), 0) into v_earmarked
  from invoice_line_items where from_payment_id = p_payment_id;
  if v_earmarked > 0 and v_amount > 0 then
    v_scale := least(1, v_amount / v_earmarked);
    insert into fee_payment_allocations (payment_id, cost_centre_id, fee_item_id, amount, basis)
    select p_payment_id, g.cc, g.item, round(g.amt * v_scale, 2), 'earmarked'
    from (
      select fi.cost_centre_id as cc,
             case when fi.cost_centre_id is null then l.fee_item_id end as item,
             sum(l.amount) as amt
      from invoice_line_items l
      left join fee_items fi on fi.id = l.fee_item_id
      where l.from_payment_id = p_payment_id
      group by 1, 2
    ) g
    where round(g.amt * v_scale, 2) <> 0;
  end if;
  select v_amount - coalesce(sum(amount), 0) into v_rest
  from fee_payment_allocations where payment_id = p_payment_id;

  -- 2. The rest, pro rata across what the invoice still owes each fund.
  v_rest := v_rest - fee_payment_spread(p_payment_id, v_rest);

  -- 3. Anything left over is credit in the general fund.
  if v_rest <> 0 then
    insert into fee_payment_allocations (payment_id, cost_centre_id, amount, basis)
    values (p_payment_id, v_general, v_rest, 'credit');
  end if;
end;
$$;

-- Applies an invoice's unused credit to what it now owes, oldest payment first.
create or replace function public.apply_fee_payment_credit(p_invoice_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_general bigint;
  v_used numeric;
begin
  select id into v_general from cost_centres where kind = 'general_pool';
  for r in
    select a.payment_id, sum(a.amount) as credit
    from fee_payment_allocations a
    join fee_payments p on p.id = a.payment_id
    where p.invoice_id = p_invoice_id and a.basis = 'credit'
    group by a.payment_id
    having sum(a.amount) > 0
    order by a.payment_id
  loop
    v_used := fee_payment_spread(r.payment_id, r.credit);
    if v_used > 0 then
      delete from fee_payment_allocations where payment_id = r.payment_id and basis = 'credit';
      if r.credit - v_used <> 0 then
        insert into fee_payment_allocations (payment_id, cost_centre_id, amount, basis)
        values (r.payment_id, v_general, r.credit - v_used, 'credit');
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.fee_invoice_owed(bigint) from public, anon, authenticated;
revoke execute on function public.fee_payment_spread(bigint, numeric) from public, anon, authenticated;
revoke execute on function public.allocate_fee_payment(bigint) from public, anon, authenticated;
revoke execute on function public.apply_fee_payment_credit(bigint) from public, anon, authenticated;

-- Triggers. SECURITY DEFINER so the bursar's own insert can write the shares
-- (the lesson of migrations 214 and 217).
create or replace function public.trg_fee_payment_allocate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform allocate_fee_payment(new.id);
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id and old.invoice_id is not null then
    perform apply_fee_payment_credit(old.invoice_id);
  end if;
  return null;
end;
$$;

create or replace function public.trg_fee_line_allocate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op <> 'INSERT' and old.from_payment_id is not null then
    perform allocate_fee_payment(old.from_payment_id);
  end if;
  if tg_op <> 'DELETE' and new.from_payment_id is not null
     and (tg_op = 'INSERT' or new.from_payment_id is distinct from old.from_payment_id or new.amount <> old.amount) then
    perform allocate_fee_payment(new.from_payment_id);
  end if;
  if tg_op <> 'DELETE' and new.invoice_id is not null then
    perform apply_fee_payment_credit(new.invoice_id);
  end if;
  return null;
end;
$$;

-- An item given its first fund takes its "not assigned" money with it.
create or replace function public.trg_fee_item_fund_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.cost_centre_id is null and new.cost_centre_id is not null then
    update fee_payment_allocations
    set cost_centre_id = new.cost_centre_id, fee_item_id = null
    where fee_item_id = new.id and cost_centre_id is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_fee_payment_allocate() from public, anon, authenticated;
revoke execute on function public.trg_fee_line_allocate() from public, anon, authenticated;
revoke execute on function public.trg_fee_item_fund_assigned() from public, anon, authenticated;

create trigger trg_fee_payment_allocate
  after insert or update of amount, invoice_id on public.fee_payments
  for each row execute function public.trg_fee_payment_allocate();
create trigger trg_fee_line_allocate
  after insert or update or delete on public.invoice_line_items
  for each row execute function public.trg_fee_line_allocate();
create trigger trg_fee_item_fund_assigned
  after update of cost_centre_id on public.fee_items
  for each row execute function public.trg_fee_item_fund_assigned();

-- 4. Setting an item's fund --------------------------------------------------

create or replace function public.set_fee_item_cost_centre(p_fee_item_id bigint, p_cost_centre_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old bigint;
begin
  if not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can choose which fund a fee item pays into.';
  end if;
  select cost_centre_id into v_old from fee_items where id = p_fee_item_id for update;
  if not found then
    raise exception 'Fee item not found.';
  end if;
  if p_cost_centre_id is null then
    raise exception 'Choose a fund.';
  end if;
  if not exists (select 1 from cost_centres where id = p_cost_centre_id and active
                 and kind in ('general_pool', 'allocated', 'ring_fenced', 'held')) then
    raise exception 'Choose an active fund other than Contingency.';
  end if;
  if v_old is not null and v_old <> p_cost_centre_id
     and exists (select 1 from invoice_line_items where fee_item_id = p_fee_item_id) then
    raise exception 'This item has already been charged, so its fund can''t change. Add a new fee item for the other fund.';
  end if;
  update fee_items set cost_centre_id = p_cost_centre_id where id = p_fee_item_id;
end;
$$;
revoke execute on function public.set_fee_item_cost_centre(bigint, bigint) from public, anon;
grant execute on function public.set_fee_item_cost_centre(bigint, bigint) to authenticated;

-- 5. What the page reads -----------------------------------------------------

-- Charged and collected per fund for one academic year ('2026/27'), by the
-- fee term the invoice belongs to. Unassigned items come back one row each.
create or replace function public.finance_fund_summary(p_academic_year text)
returns table (
  cost_centre_id bigint, name text, kind text, sort_order integer, active boolean,
  fee_item_id bigint, charged numeric, collected numeric, credit numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_view_budget() then
    raise exception 'You don''t have access to the budget.';
  end if;
  return query
  with inv as (
    select si.id from student_invoices si
    join fee_terms ft on ft.id = si.term_id
    where ft.academic_year = p_academic_year
  ), ch as (
    select fi.cost_centre_id as cc,
           case when fi.cost_centre_id is null then l.fee_item_id end as item,
           sum(l.amount) as amt
    from invoice_line_items l
    left join fee_items fi on fi.id = l.fee_item_id
    where l.invoice_id in (select id from inv)
    group by 1, 2
  ), co as (
    select a.cost_centre_id as cc, a.fee_item_id as item,
           sum(a.amount) as amt,
           sum(a.amount) filter (where a.basis = 'credit') as cr
    from fee_payment_allocations a
    join fee_payments p on p.id = a.payment_id
    where p.invoice_id in (select id from inv)
    group by 1, 2
  ), keys as (
    select cc, item from ch union select cc, item from co
    union select c.id, null::bigint from cost_centres c
  )
  select k.cc, c.name, c.kind, c.sort_order, c.active, k.item,
         coalesce(ch.amt, 0)::numeric, coalesce(co.amt, 0)::numeric, coalesce(co.cr, 0)::numeric
  from keys k
  left join cost_centres c on c.id = k.cc
  left join ch on ch.cc is not distinct from k.cc and ch.item is not distinct from k.item
  left join co on co.cc is not distinct from k.cc and co.item is not distinct from k.item
  where k.cc is not null or k.item is not null or ch.amt is not null or co.amt is not null;
end;
$$;
revoke execute on function public.finance_fund_summary(text) from public, anon;
grant execute on function public.finance_fund_summary(text) to authenticated;

-- Every fee item and its fund, for the page (the principal and the college
-- secretary don't otherwise read fee items).
create or replace function public.finance_fee_item_funds()
returns table (fee_item_id bigint, name text, category text, cost_centre_id bigint, charged boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_view_budget() then
    raise exception 'You don''t have access to the budget.';
  end if;
  return query
  select fi.id, coalesce(fi.display_name, fi.name), fi.category, fi.cost_centre_id,
         exists (select 1 from invoice_line_items l where l.fee_item_id = fi.id)
  from fee_items fi
  order by fi.name;
end;
$$;
revoke execute on function public.finance_fee_item_funds() from public, anon;
grant execute on function public.finance_fee_item_funds() to authenticated;

-- 6. The page and the permissions page ---------------------------------------

insert into public.resources (resource_key, label, section, sort_order) values
  ('/finance/budget', 'Budget', 'Fees & Bills', 1)
on conflict (resource_key) do nothing;

-- The principal only for now; the bursar, SMT and the college secretary are
-- added when it opens.
insert into public.role_permissions (role_name, resource_key) values
  ('principal', '/finance/budget')
on conflict do nothing;

-- Shown padlocked at /admin/permissions: these are the principal's rules.
insert into public.role_ability_tables (table_name, stage) values
  ('cost_centres', 7), ('fee_payment_allocations', 7)
on conflict (table_name) do nothing;
insert into public.role_ability_locks (table_name, action, reason) values
  ('cost_centres', 'view', 'The principal only, while the budget is being built (fixed rule)'),
  ('cost_centres', 'add', 'The principal or the college secretary only (fixed rule)'),
  ('cost_centres', 'edit', 'The principal or the college secretary only (fixed rule)'),
  ('cost_centres', 'delete', 'Never deleted; archived instead'),
  ('fee_payment_allocations', 'view', 'The principal only, while the budget is being built (fixed rule)'),
  ('fee_payment_allocations', 'add', 'Worked out by the database when a payment is recorded'),
  ('fee_payment_allocations', 'edit', 'Worked out by the database when a payment is recorded'),
  ('fee_payment_allocations', 'delete', 'Worked out by the database when a payment is recorded')
on conflict (table_name, action) do nothing;

-- 7. Split the payments already recorded ------------------------------------

do $$
declare
  r record;
begin
  for r in select id from public.fee_payments order by id loop
    perform public.allocate_fee_payment(r.id);
  end loop;
end;
$$;
