-- Migration 343: fees by year AND term, discounts and bursaries counted from
-- the students who have them, and 3rd-child suggestions from siblings.
--
-- Why: the principal, 3 Oct 2026, sharing the school's own budget sheet: "I
-- was expecting to put the fees per year and per term in and to use the
-- numbers to calculate income. Obviously it needs to be able to deal with
-- things like optional amounts and number of students in discounts. This
-- discount needs to have a flag set against the student third child." The
-- sheet: paying students per year per term x the termly fee; Year 12 pays
-- double in Term 2 (Term 3 paid in advance, as they leave) and nothing in
-- Term 3; bursary students pay a reduced fee. Decisions (3 Oct 2026):
--   * Fees by year and term are an approved price list: the principal and
--     the college secretary approve it together, the bursar can only charge
--     those prices, and the forecast uses them.
--   * Bursaries are flagged once on each student (a discount type, like
--     3rd child), applying every term until removed.
--   * 3rd-child flags are suggested from siblings and confirmed by the
--     bursar.
--
-- How it works:
--   * fee_item_term_prices: an approved price for a locked fee item, for one
--     school term (terms.term_id) and year group. Written only when both
--     approve a 'fee_item_term_prices' proposal (fee_price_changes.term_id,
--     propose_fee_item_term_prices(), approve_fee_price_change()). A year
--     group left blank in a term falls back to the item's year price, then
--     its single price, so only the terms that differ need a list.
--   * fee_price_for(item, year, term) picks the price in that order. It is
--     what charging and the forecast both use.
--   * fee_terms.term_id links each fee term (invoices) to its school term,
--     so enforce_locked_fee_price() charges the term's price. "1st Term"
--     (2026/27) is the September Term 2026. A fee term with no link keeps
--     the old rule (year price, then single price).
--   * The forecast (budget_term_forecast) now uses the term's prices, and
--     shows each discount type as its own line: the number of active
--     students in each year with that discount (an open-ended
--     student_discounts row), and what it takes off. A percentage is of that
--     term's tuition price for their year, as apply_student_discount() does
--     on an invoice, so a bursary set as a percentage doubles with Year
--     12's double Term 2 by itself. (Bursaries that "pay N500,000 of
--     N1,500,000" are 66.6666667% off; discount values now keep seven
--     decimals so that comes to the exact naira.)
--   * fee_discount_types.from_child_number marks a sibling discount: 3 on
--     "3rd child" means the 3rd and later children. sibling_discount_
--     suggestions() lists active students whose place among their active
--     siblings (oldest first, by date of birth; siblings as
--     student_siblings() finds them, "Other" links never counting) reaches
--     it and who don't have that discount. The bursar confirms each at
--     Discounts, which adds the student_discounts row (the existing,
--     tickable insert). Read by anyone with /bursar/discounts.

set local formwork.change_note = 'Principal (direct)';

-- 1. Which school term each fee term is ---------------------------------------

alter table public.fee_terms add column if not exists term_id integer references public.terms(term_id);
update public.fee_terms ft set term_id = t.term_id
from public.terms t
where ft.term_id is null and ft.name = '1st Term' and ft.academic_year = '2026/27'
  and t.term_name = 'September Term 2026';

-- 2. Prices by year and term --------------------------------------------------

create table public.fee_item_term_prices (
  id bigint generated always as identity primary key,
  fee_item_id bigint not null references public.fee_items(id),
  term_id integer not null references public.terms(term_id),
  year_group integer not null check (year_group between 7 and 12),
  amount numeric(12,2) not null check (amount >= 0),
  approved_change_id bigint references public.fee_price_changes(id)
);
create unique index fee_item_term_prices_one on public.fee_item_term_prices (fee_item_id, term_id, year_group);

alter table public.fee_item_term_prices enable row level security;
grant select on public.fee_item_term_prices to authenticated;
create policy fee_item_term_prices_read on public.fee_item_term_prices for select to authenticated
  using (can_propose_fee_prices() or can_view_budget());

create trigger trg_log_change after insert or update or delete on public.fee_item_term_prices
  for each row execute function public.log_change('fees', 'id');

alter table public.fee_price_changes add column if not exists term_id integer references public.terms(term_id);

alter table public.fee_price_changes drop constraint if exists fee_price_changes_kind_check;
alter table public.fee_price_changes add constraint fee_price_changes_kind_check
  check (kind in ('admission_fees', 'fee_item', 'fee_item_prices', 'fee_item_term_prices'));

alter table public.fee_price_changes drop constraint if exists fee_price_changes_target;
alter table public.fee_price_changes add constraint fee_price_changes_target check (
  (kind = 'admission_fees' and academic_year_id is not null and fee_item_id is null and term_id is null)
  or (kind in ('fee_item', 'fee_item_prices') and fee_item_id is not null and academic_year_id is null and term_id is null)
  or (kind = 'fee_item_term_prices' and fee_item_id is not null and term_id is not null and academic_year_id is null));

create unique index fee_price_changes_one_pending_item_term
  on public.fee_price_changes (fee_item_id, term_id) where status = 'pending' and kind = 'fee_item_term_prices';

-- p_prices: {"7": 1500000, ..., "12": 3000000}; null or missing = no price
-- for that year in this term (the year price applies).
create or replace function public.propose_fee_item_term_prices(
  p_fee_item_id bigint, p_term_id integer, p_prices jsonb, p_reason text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
  v_term text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_yg integer;
  v_amount numeric;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into f from fee_items where id = p_fee_item_id;
  if f.id is null then
    raise exception 'Fee item not found.';
  end if;
  if not f.price_locked then
    raise exception '% isn''t charged by approved price.', coalesce(f.display_name, f.name);
  end if;
  select term_name into v_term from terms where term_id = p_term_id;
  if v_term is null then
    raise exception 'Term not found.';
  end if;
  for v_yg in 7..12 loop
    v_amount := nullif(p_prices->>v_yg::text, '')::numeric;
    if v_amount < 0 then
      raise exception 'Amounts can''t be negative.';
    end if;
    v_new := v_new || jsonb_build_object(v_yg::text, v_amount);
    v_old := v_old || jsonb_build_object(v_yg::text,
      (select amount from fee_item_term_prices
       where fee_item_id = p_fee_item_id and term_id = p_term_id and year_group = v_yg));
  end loop;
  if v_new = v_old then
    raise exception 'Those are already the prices for %.', v_term;
  end if;
  if exists (select 1 from fee_price_changes where kind = 'fee_item_term_prices'
             and fee_item_id = p_fee_item_id and term_id = p_term_id and status = 'pending') then
    raise exception 'Prices for % in % are already waiting for approval. Approve, reject or cancel them first.',
      coalesce(f.display_name, f.name), v_term;
  end if;

  insert into fee_price_changes (kind, fee_item_id, term_id, old_values, new_values, reason, requested_by)
  values ('fee_item_term_prices', p_fee_item_id, p_term_id, v_old, v_new, nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.propose_fee_item_term_prices(bigint, integer, jsonb, text) from public, anon;
grant execute on function public.propose_fee_item_term_prices(bigint, integer, jsonb, text) to authenticated;

-- Same as migration 260, plus applying 'fee_item_term_prices'.
create or replace function public.approve_fee_price_change(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c fee_price_changes;
  v_principal boolean := holds_staff_role('principal');
  v_secretary boolean := holds_staff_role('college_secretary');
  v_yg integer;
  v_amount numeric;
begin
  if not (v_principal or v_secretary) then
    raise exception 'Only the principal and the college secretary can approve fee prices.';
  end if;
  select * into c from fee_price_changes where id = p_id for update;
  if c.id is null then
    raise exception 'Not found.';
  end if;
  if c.status <> 'pending' then
    raise exception 'This change is already %.', c.status;
  end if;
  if auth.uid() in (c.principal_approved_by, c.secretary_approved_by) then
    raise exception 'You have already approved this. It needs the other approver.';
  end if;

  if v_principal and c.principal_approved_by is null then
    update fee_price_changes set principal_approved_by = auth.uid(), principal_approved_at = now() where id = p_id;
  elsif v_secretary and c.secretary_approved_by is null then
    update fee_price_changes set secretary_approved_by = auth.uid(), secretary_approved_at = now() where id = p_id;
  else
    raise exception 'Your approval is already in; it needs the other approver.';
  end if;

  select * into c from fee_price_changes where id = p_id;
  if c.principal_approved_by is null or c.secretary_approved_by is null then
    return 'waiting';
  end if;

  if c.kind = 'admission_fees' then
    update academic_years
       set admission_form_fee = (c.new_values->>'form_fee')::numeric,
           admission_deposit = (c.new_values->>'deposit')::numeric
     where academic_year_id = c.academic_year_id;
  elsif c.kind = 'fee_item' then
    update fee_items set default_amount = (c.new_values->>'amount')::numeric where id = c.fee_item_id;
  elsif c.kind = 'fee_item_term_prices' then
    for v_yg in 7..12 loop
      v_amount := (c.new_values->>v_yg::text)::numeric;
      if v_amount is null then
        delete from fee_item_term_prices
        where fee_item_id = c.fee_item_id and term_id = c.term_id and year_group = v_yg;
      else
        insert into fee_item_term_prices (fee_item_id, term_id, year_group, amount, approved_change_id)
        values (c.fee_item_id, c.term_id, v_yg, v_amount, c.id)
        on conflict (fee_item_id, term_id, year_group)
        do update set amount = excluded.amount, approved_change_id = excluded.approved_change_id;
      end if;
    end loop;
  else
    for v_yg in 7..12 loop
      v_amount := (c.new_values->>v_yg::text)::numeric;
      if v_amount is null then
        delete from fee_item_year_prices where fee_item_id = c.fee_item_id and year_group = v_yg;
      else
        insert into fee_item_year_prices (fee_item_id, year_group, amount, approved_change_id)
        values (c.fee_item_id, v_yg, v_amount, c.id)
        on conflict (fee_item_id, year_group)
        do update set amount = excluded.amount, approved_change_id = excluded.approved_change_id;
      end if;
    end loop;
  end if;
  update fee_price_changes set status = 'approved', closed_at = now() where id = p_id;
  return 'applied';
end;
$$;

-- The approvals page reads a proposal's term from fee_price_changes.term_id
-- (readable by the same people as fee_price_change_list()).

-- 3. One rule for "what does this item cost", for charging and forecasting ---

create or replace function public.fee_price_for(p_fee_item_id bigint, p_year_group integer, p_term_id integer)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select amount from fee_item_term_prices
     where fee_item_id = p_fee_item_id and term_id = p_term_id and year_group = p_year_group),
    (select amount from fee_item_year_prices
     where fee_item_id = p_fee_item_id and year_group = p_year_group),
    (select default_amount from fee_items where id = p_fee_item_id));
$$;
revoke execute on function public.fee_price_for(bigint, integer, integer) from public, anon;
grant execute on function public.fee_price_for(bigint, integer, integer) to authenticated;

create or replace function public.enforce_locked_fee_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
  v_year integer;
  v_term integer;
  v_term_name text;
  v_price numeric;
begin
  if new.fee_item_id is null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.amount is not distinct from old.amount
     and new.fee_item_id is not distinct from old.fee_item_id
     and new.invoice_id is not distinct from old.invoice_id then
    return new;
  end if;
  select * into f from fee_items where id = new.fee_item_id;
  if not coalesce(f.price_locked, false) then
    return new;
  end if;

  select s.year_group, ft.term_id, t.term_name into v_year, v_term, v_term_name
    from student_invoices si
    join students s on s.student_id = si.student_id
    left join fee_terms ft on ft.id = si.term_id
    left join terms t on t.term_id = ft.term_id
   where si.id = new.invoice_id;
  v_price := fee_price_for(f.id, v_year, v_term);

  if v_price is null then
    raise exception '% has no approved price for Year %. It must be approved by the principal and the college secretary before it can be charged.',
      coalesce(f.display_name, f.name), v_year;
  end if;
  if new.amount is distinct from v_price then
    raise exception '% is charged at its approved price for Year %: %. Other amounts need approval first.',
      coalesce(f.display_name, f.name), v_year || coalesce(' in ' || v_term_name, ''),
      to_char(v_price, 'FM999,999,990.00');
  end if;
  return new;
end;
$$;

-- 4. Discount percentages precise enough for bursaries, and sibling discounts --

-- A bursary that "pays N500,000 of N1,500,000" is 66.6666667% off. With two
-- decimals (66.67) it came out N100 wrong per student in the dry run; seven
-- decimals round to the exact naira on every termly fee. No view uses it.
alter table public.fee_discount_types alter column value type numeric(14,7);


alter table public.fee_discount_types add column if not exists from_child_number integer
  check (from_child_number is null or from_child_number between 2 and 10);
comment on column public.fee_discount_types.from_child_number is
  'A sibling discount: given to the Nth and later child of a family (3 = 3rd child). Used to suggest students at Discounts (migration 343).';

update public.fee_discount_types set from_child_number = 3
where from_child_number is null and lower(btrim(name)) in ('3rd child', 'third child');

create or replace function public.sibling_discount_suggestions()
returns table (
  student_id integer, first_name text, last_name text, year_group integer, form_class text,
  child_number integer, discount_type_id bigint, discount_name text, older_siblings text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/bursar/discounts') then
    raise exception 'You don''t have access to discounts.';
  end if;
  return query
  with active as (
    select s.student_id, s.first_name, s.last_name, s.year_group, s.form_class, s.dob
    from students s where s.status = 'active'
  ), placed as (
    select a.*,
           (select count(*) from student_siblings(a.student_id) sib
            join active o on o.student_id = sib.student_id
            where coalesce(o.dob, 'infinity'::date) < coalesce(a.dob, 'infinity'::date)
               or (coalesce(o.dob, 'infinity'::date) = coalesce(a.dob, 'infinity'::date) and o.student_id < a.student_id)
           )::integer + 1 as n,
           (select string_agg(o.first_name || ' ' || o.last_name || ' (Y' || o.year_group || ')', ', ' order by o.dob nulls last)
            from student_siblings(a.student_id) sib
            join active o on o.student_id = sib.student_id
            where coalesce(o.dob, 'infinity'::date) < coalesce(a.dob, 'infinity'::date)
               or (coalesce(o.dob, 'infinity'::date) = coalesce(a.dob, 'infinity'::date) and o.student_id < a.student_id)
           ) as older
    from active a
  )
  select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, p.n,
         dt.id, dt.name, p.older
  from placed p
  join fee_discount_types dt on dt.from_child_number is not null and p.n >= dt.from_child_number
  where not exists (
    select 1 from student_discounts sd
    where sd.student_id = p.student_id and sd.discount_type_id = dt.id and sd.end_term_id is null)
  order by p.year_group, p.last_name, p.first_name;
end;
$$;
revoke execute on function public.sibling_discount_suggestions() from public, anon;
grant execute on function public.sibling_discount_suggestions() to authenticated;

-- 5. The forecast: term prices, and each discount type as its own line ----------

-- Same columns as migration 339 (so it can be replaced in place); a discount
-- line carries the Discount fee item and the discount type's name.
create or replace function public.budget_term_forecast(p_term_id integer)
returns table (
  fee_item_id bigint, name text, category text, cost_centre_id bigint, is_optional boolean,
  year_group integer, headcount integer, students integer, entered boolean,
  price numeric, amount numeric
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
  with years as (
    select s.year_group as yg, count(*)::integer as n
    from students s
    where s.status = 'active' and s.year_group between 7 and 12
    group by s.year_group
  ), items as (
    select fi.*
    from fee_items fi
    left join cost_centres cc on cc.id = fi.cost_centre_id
    where coalesce(cc.kind, '') <> 'held'
      and lower(btrim(coalesce(fi.category, ''))) not in ('damages', 'discount', 'tuckshop')
  ), top_tuition as (
    select i.id from items i
    where lower(btrim(i.category)) = 'tuition'
    order by i.default_amount desc nulls last, i.id
    limit 1
  ), grid as (
    select i.id, i.name as nm, i.category as cat, i.cost_centre_id as cc,
           coalesce(i.is_optional, false) as opt, y.yg, y.n,
           bfc.students as entered_n,
           case
             when coalesce(i.is_optional, false) then 0
             when lower(btrim(i.category)) = 'tuition' then
               case when i.id = (select id from top_tuition) then y.n else 0 end
             else y.n
           end as default_n,
           coalesce(fee_price_for(i.id, y.yg, p_term_id), 0) as pr
    from items i
    cross join years y
    left join budget_forecast_counts bfc
      on bfc.term_id = p_term_id and bfc.fee_item_id = i.id and bfc.year_group = y.yg
  ), discount_item as (
    select fi.id, fi.category, fi.cost_centre_id from fee_items fi
    where lower(btrim(fi.category)) = 'discount' order by fi.id limit 1
  ), discounts as (
    -- Each discount type, per year: active students who have it (open-ended),
    -- and what it takes off that term's top tuition price for their year.
    select dt.id as dt_id, dt.name as dt_name, y.yg, y.n,
           count(*)::integer as dn,
           sum(case when dt.calc_type = 'percentage'
                    then round(coalesce(fee_price_for((select id from top_tuition), y.yg, p_term_id), 0) * dt.value / 100, 2)
                    else dt.value end) as off
    from student_discounts sd
    join students s on s.student_id = sd.student_id and s.status = 'active'
    join years y on y.yg = s.year_group
    join fee_discount_types dt on dt.id = sd.discount_type_id
      and coalesce(lower(dt.applies_to), 'tuition') = 'tuition'
    where sd.end_term_id is null
    group by dt.id, dt.name, y.yg, y.n
  )
  select g.id, g.nm, g.cat, g.cc, g.opt, g.yg, g.n,
         coalesce(g.entered_n, g.default_n), g.entered_n is not null,
         g.pr::numeric, (coalesce(g.entered_n, g.default_n) * g.pr)::numeric
  from grid g
  union all
  select di.id, d.dt_name, di.category, di.cost_centre_id, false, d.yg, d.n,
         d.dn, false, null::numeric, (-d.off)::numeric
  from discounts d
  cross join discount_item di;
end;
$$;

-- 6. Shown padlocked at /admin/permissions ------------------------------------

insert into public.role_ability_tables (table_name, stage) values ('fee_item_term_prices', 7)
on conflict (table_name) do nothing;
insert into public.role_ability_locks (table_name, action, reason) values
  ('fee_item_term_prices', 'view', 'Those who can propose fee prices, the two approvers, and the budget (fixed rule)'),
  ('fee_item_term_prices', 'add', 'Only when the principal and the college secretary both approve (fixed rule)'),
  ('fee_item_term_prices', 'edit', 'Only when the principal and the college secretary both approve (fixed rule)'),
  ('fee_item_term_prices', 'delete', 'Only when the principal and the college secretary both approve (fixed rule)')
on conflict (table_name, action) do nothing;
