-- Migration 348: which terms a fee is charged in, and adding a fee in one
-- numbered step.
--
-- Why: the principal, 3 Oct 2026: "Adding fee items needs to be clearly
-- numbered and sometimes it is only available on one term sometimes all."
-- Until now a new fee took five separate pages (add the item, approve its
-- price, choose its fund, set term prices, check the forecast), and every
-- fee could be charged in any term. An exam fee such as WAEC is charged in
-- one term only; tuition in every term.
--
--   * fee_items.charge_term_ids: the school terms (terms.term_id) a fee can
--     be charged in. Null or empty = every term (all existing items, so
--     nothing changes for them). Checked against terms by
--     fee_items_check_terms(). Changes are logged with the rest of
--     fee_items (change_history 'fees'); nothing is deleted.
--   * enforce_fee_item_term() on invoice_line_items refuses a charge for a
--     fee in a term it isn't charged in (through fee_terms.term_id, so a fee
--     term that isn't linked to a school term can't take a one-term fee),
--     whenever someone is signed in, like enforce_locked_fee_price().
--   * budget_term_forecast() (same shape) leaves a fee out of the terms it
--     isn't charged in.
--   * add_fee_item() does the whole of "Add a fee" in one go: (1) name,
--     what parents see, category, optional; (2) the fund (the principal or
--     the college secretary only, through set_fee_item_cost_centre()); (3)
--     which terms; (4) prices, sent for the usual two-person approval
--     (term prices per chosen term, or year prices for every term, for a
--     locked item; one price otherwise). Nothing about approval changes:
--     the prices still apply only when the principal and the college
--     secretary have both approved them at Fee Approvals.

set local formwork.change_note = 'Principal (direct)';

alter table public.fee_items add column if not exists charge_term_ids integer[];

comment on column public.fee_items.charge_term_ids is
  'School terms (terms.term_id) this fee can be charged in; null or empty = every term (migration 348).';

create or replace function public.fee_items_check_terms()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if cardinality(new.charge_term_ids) = 0 then
    new.charge_term_ids := null;
  end if;
  if new.charge_term_ids is not null then
    if exists (select 1 from unnest(new.charge_term_ids) t(id)
               where not exists (select 1 from terms where term_id = t.id)) then
      raise exception 'Choose terms from the school''s list of terms.';
    end if;
    select array_agg(distinct t.id order by t.id) into new.charge_term_ids
      from unnest(new.charge_term_ids) t(id);
  end if;
  return new;
end;
$$;

create trigger trg_fee_items_check_terms before insert or update of charge_term_ids on public.fee_items
  for each row execute function public.fee_items_check_terms();

create or replace function public.fee_item_charged_in(p_fee_item_id bigint, p_term_id integer)
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(fi.charge_term_ids), 0) = 0
      or (p_term_id is not null and p_term_id = any (fi.charge_term_ids))
  from fee_items fi where fi.id = p_fee_item_id;
$$;

grant execute on function public.fee_item_charged_in(bigint, integer) to authenticated;

create or replace function public.enforce_fee_item_term()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f fee_items;
  v_term integer;
  v_fee_term text;
  v_names text;
begin
  if new.fee_item_id is null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.fee_item_id is not distinct from old.fee_item_id
     and new.invoice_id is not distinct from old.invoice_id then
    return new;
  end if;
  select * into f from fee_items where id = new.fee_item_id;
  if coalesce(cardinality(f.charge_term_ids), 0) = 0 then
    return new;
  end if;
  select ft.term_id, ft.name into v_term, v_fee_term
    from student_invoices si
    join fee_terms ft on ft.id = si.term_id
   where si.id = new.invoice_id;
  if v_term is null or not (v_term = any (f.charge_term_ids)) then
    select string_agg(t.term_name, ', ' order by t.start_date) into v_names
      from terms t where t.term_id = any (f.charge_term_ids);
    raise exception '% is charged only in %, not in %.',
      coalesce(f.display_name, f.name), v_names, coalesce(v_fee_term, 'this term');
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_fee_item_term() from public, anon, authenticated;

create trigger trg_enforce_fee_item_term before insert or update on public.invoice_line_items
  for each row execute function public.enforce_fee_item_term();

-- The forecast, as in migration 343, leaving out fees not charged in the term.
create or replace function public.budget_term_forecast(p_term_id integer)
returns table (
  fee_item_id bigint, name text, category text, cost_centre_id bigint, is_optional boolean,
  year_group integer, headcount integer, students integer, entered boolean,
  price numeric, amount numeric
)
language plpgsql
stable security definer
set search_path = public, pg_temp
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
  ), all_items as (
    select fi.*
    from fee_items fi
    left join cost_centres cc on cc.id = fi.cost_centre_id
    where coalesce(cc.kind, '') <> 'held'
      and lower(btrim(coalesce(fi.category, ''))) not in ('damages', 'discount', 'tuckshop')
  ), items as (
    select a.* from all_items a
    where coalesce(cardinality(a.charge_term_ids), 0) = 0 or p_term_id = any (a.charge_term_ids)
  ), top_tuition as (
    select i.id from all_items i
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

-- "Add a fee" in one call. p_prices:
--   locked item, every term:   {"all": {"7": 100000, ..., "12": 120000}}
--   locked item, chosen terms: {"<term_id>": {"7": ..., "12": ...}, ...}
--   any other item:            {"single": 50000}
-- A blank year has no price, so that year can't be charged it.
create or replace function public.add_fee_item(
  p_name text, p_display_name text, p_category text, p_is_optional boolean,
  p_cost_centre_id bigint, p_term_ids integer[], p_prices jsonb, p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f fee_items;
  v_id bigint;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'New fee');
  v_term integer;
  v_prices jsonb;
  v_sent integer := 0;
begin
  if not (can_propose_fee_prices() and has_ability('fee_items', 'add')) then
    raise exception 'You can''t add fees.';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Give the fee a name.';
  end if;
  if exists (select 1 from fee_items where lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'There is already a fee called %.', btrim(p_name);
  end if;
  if p_cost_centre_id is not null and not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can choose which fund a fee pays into. Leave the fund for them.';
  end if;

  insert into fee_items (name, display_name, category, is_optional, charge_term_ids)
  values (btrim(p_name), nullif(btrim(p_display_name), ''), nullif(btrim(p_category), ''),
          coalesce(p_is_optional, false), p_term_ids)
  returning id into v_id;

  if p_cost_centre_id is not null then
    perform set_fee_item_cost_centre(v_id, p_cost_centre_id);
  end if;

  select * into f from fee_items where id = v_id;
  if f.price_locked then
    if f.charge_term_ids is null then
      v_prices := p_prices->'all';
      if exists (select 1 from jsonb_each_text(coalesce(v_prices, '{}')) e where nullif(e.value, '') is not null) then
        perform propose_fee_item_year_prices(v_id, v_prices, v_reason);
        v_sent := v_sent + 1;
      end if;
    else
      foreach v_term in array f.charge_term_ids loop
        v_prices := p_prices->(v_term::text);
        if exists (select 1 from jsonb_each_text(coalesce(v_prices, '{}')) e where nullif(e.value, '') is not null) then
          perform propose_fee_item_term_prices(v_id, v_term, v_prices, v_reason);
          v_sent := v_sent + 1;
        end if;
      end loop;
    end if;
  elsif nullif(p_prices->>'single', '') is not null then
    perform propose_fee_item_price(v_id, (p_prices->>'single')::numeric, v_reason);
    v_sent := v_sent + 1;
  end if;

  if v_sent = 0 then
    raise exception 'Give at least one price to send for approval.';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.add_fee_item(text, text, text, boolean, bigint, integer[], jsonb, text) from public, anon;
grant execute on function public.add_fee_item(text, text, text, boolean, bigint, integer[], jsonb, text) to authenticated;

-- The Fees & Bills tile's pages, numbered in the order the work is done
-- (the principal, 3 Oct 2026: "The fees and bills tile is not clear about use").
update public.resources r set label = v.label, sort_order = v.ord
from (values
  ('/bursar/fee-items', '1 Fees', 70),
  ('/bursar/fee-approvals', '2 Approve', 71),
  ('/bursar/discounts', '3 Discounts', 72),
  ('/bursar/charge-checklist', '4 Charge', 73),
  ('/bursar/payments', '5 Payments', 74),
  ('/bursar/fees-table', '6 Accounts', 75),
  ('/bursar/debtors', '7 Debtors', 76),
  ('/bursar/audit', '8 Audit', 77),
  ('/bursar/admission-forms', '9 Admissions', 78),
  ('/smt/fees-dashboard', '10 Summary', 79)
) as v(key, label, ord)
where r.resource_key = v.key;
