-- Migration 339: the term forecast: what each fee item should bring in for a
-- term, from the number of students in each year group (budgets phase 2a).
--
-- Why: the principal, 3 Oct 2026: "The fees items need to complete the amount
-- available for the term using the numbers in each year." The budget starts
-- in Term 2 (January Term 2027) and is planned against what will be invoiced
-- (docs/finance-budget-design.md), but nothing is invoiced until the bursar
-- charges the term. So the Budget page needs the amount available worked out
-- in advance: for each fee item and year group, students paying x approved
-- price, totalled by fund.
--
-- How it works:
--   * The number of students paying each item in each year group starts from
--     the live headcount of active students (students.year_group), so it
--     follows admissions and leavers until someone changes it:
--       - compulsory items (medical, ICT): every student in the year;
--       - tuition: every student on the highest-priced tuition item
--         (School Fees Full), none on the others (old, staff), since each
--         student pays only one; move students between them by hand;
--       - optional items (swimming, sports academy, taekwondo): none until
--         a number is entered.
--     A number entered for a term replaces the default for that term only.
--     Tuck shop, damages and the Discount item are left out (not term fees).
--   * Price: the item's approved price for the year group
--     (fee_item_year_prices), else its approved single price. Read live, so
--     an approved price change shows at once.
--   * Discounts: every active student with an open-ended discount
--     (student_discounts.end_term_id null) is forecast to get it on the
--     highest tuition price for their year: a percentage of it, or the fixed
--     amount. They reduce the general fund (the principal: discounts on
--     tuition only).
--   * budget_forecast_counts holds the numbers entered, one row per term,
--     item and year group. Written only through set_budget_forecast_count()
--     (the principal or the college secretary); a number is changed, never
--     deleted ("use the headcount" again stores null, and who did it is
--     stamped). Logged under change_history 'finance'.
--   * Fee items are shown by their own names (finance_fee_item_funds() is
--     changed too): the three tuition items share the display name parents
--     see, "School Fees".
--   * budget_term_forecast(term_id) returns the grid; it shows the same as
--     the rest of the budget: only the principal while it is being built
--     (can_view_budget()).

set local formwork.change_note = 'Principal (direct)';

create table public.budget_forecast_counts (
  id bigint generated always as identity primary key,
  term_id integer not null references public.terms(term_id),
  fee_item_id bigint not null references public.fee_items(id),
  year_group integer not null check (year_group between 7 and 13),
  -- Null means "use the live headcount default" again.
  students integer check (students is null or students >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index budget_forecast_counts_one on public.budget_forecast_counts (term_id, fee_item_id, year_group);

alter table public.budget_forecast_counts enable row level security;
grant select on public.budget_forecast_counts to authenticated;
create policy budget_forecast_counts_read on public.budget_forecast_counts for select to authenticated
  using (can_view_budget());

create trigger trg_stamp_updated_by before insert or update on public.budget_forecast_counts
  for each row execute function public.stamp_actor('updated_by');
create trigger trg_log_change after insert or update or delete on public.budget_forecast_counts
  for each row execute function public.log_change('finance', 'id');

create or replace function public.set_budget_forecast_count(
  p_term_id integer, p_fee_item_id bigint, p_year_group integer, p_students integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can change the forecast.';
  end if;
  if not exists (select 1 from terms where term_id = p_term_id) then
    raise exception 'Term not found.';
  end if;
  if not exists (select 1 from fee_items where id = p_fee_item_id) then
    raise exception 'Fee item not found.';
  end if;
  if p_year_group not between 7 and 13 then
    raise exception 'Choose a year group from 7 to 13.';
  end if;
  if p_students is not null and p_students < 0 then
    raise exception 'The number of students can''t be negative.';
  end if;
  insert into budget_forecast_counts (term_id, fee_item_id, year_group, students, updated_at)
  values (p_term_id, p_fee_item_id, p_year_group, p_students, now())
  on conflict (term_id, fee_item_id, year_group)
  do update set students = excluded.students, updated_at = now()
  where budget_forecast_counts.students is distinct from excluded.students;
end;
$$;
revoke execute on function public.set_budget_forecast_count(integer, bigint, integer, integer) from public, anon;
grant execute on function public.set_budget_forecast_count(integer, bigint, integer, integer) to authenticated;

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
    where s.status = 'active' and s.year_group between 7 and 13
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
  ), top_tuition_price as (
    select y.yg, coalesce(p.amount, fi.default_amount, 0) as price
    from years y
    cross join top_tuition t
    join fee_items fi on fi.id = t.id
    left join fee_item_year_prices p on p.fee_item_id = fi.id and p.year_group = y.yg
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
           coalesce(p.amount, i.default_amount, 0) as pr
    from items i
    cross join years y
    left join fee_item_year_prices p on p.fee_item_id = i.id and p.year_group = y.yg
    left join budget_forecast_counts bfc
      on bfc.term_id = p_term_id and bfc.fee_item_id = i.id and bfc.year_group = y.yg
  ), discounts as (
    -- One row per year group: students with an open-ended discount, and what
    -- it takes off the top tuition price.
    select y.yg, y.n,
           count(sd.id)::integer as dn,
           coalesce(sum(case when dt.calc_type = 'percentage'
                             then round(ttp.price * dt.value / 100, 2)
                             else dt.value end), 0) as off
    from years y
    left join students s on s.status = 'active' and s.year_group = y.yg
    left join student_discounts sd on sd.student_id = s.student_id and sd.end_term_id is null
    left join fee_discount_types dt on dt.id = sd.discount_type_id
      and coalesce(lower(dt.applies_to), 'tuition') = 'tuition'
    left join top_tuition_price ttp on ttp.yg = y.yg
    where sd.id is null or dt.id is not null
    group by y.yg, y.n
  )
  select g.id, g.nm, g.cat, g.cc, g.opt, g.yg, g.n,
         coalesce(g.entered_n, g.default_n), g.entered_n is not null,
         g.pr::numeric, (coalesce(g.entered_n, g.default_n) * g.pr)::numeric
  from grid g
  union all
  select di.id, 'Discounts (forecast)', di.category, di.cost_centre_id, false, d.yg, d.n,
         d.dn, false, null::numeric, (-d.off)::numeric
  from discounts d
  cross join (select fi.id, fi.category, fi.cost_centre_id from fee_items fi
              where lower(btrim(fi.category)) = 'discount' order by fi.id limit 1) di
  where d.dn > 0;
end;
$$;
revoke execute on function public.budget_term_forecast(integer) from public, anon;
grant execute on function public.budget_term_forecast(integer) to authenticated;

-- The Budget page names items by their own names: the three tuition items
-- share the display name parents see ("School Fees").
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
  select fi.id, fi.name, fi.category, fi.cost_centre_id,
         exists (select 1 from invoice_line_items l where l.fee_item_id = fi.id)
  from fee_items fi
  order by fi.name;
end;
$$;

insert into public.role_ability_tables (table_name, stage) values ('budget_forecast_counts', 7)
on conflict (table_name) do nothing;
insert into public.role_ability_locks (table_name, action, reason) values
  ('budget_forecast_counts', 'view', 'The principal only, while the budget is being built (fixed rule)'),
  ('budget_forecast_counts', 'add', 'Only through the forecast, by the principal or the college secretary'),
  ('budget_forecast_counts', 'edit', 'Only through the forecast, by the principal or the college secretary'),
  ('budget_forecast_counts', 'delete', 'Never deleted; a number is changed back instead')
on conflict (table_name, action) do nothing;
