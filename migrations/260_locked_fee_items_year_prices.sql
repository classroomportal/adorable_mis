-- Migration 260: tuition, activity, technology and medical fees are charged
-- only at their approved price for the student's year group.
--
-- Why: migration 259 made fee prices need both the principal and the
-- college secretary, but the bursar's Charge Checklist still let any amount
-- be typed per student or per year group, so an approved price could be
-- side-stepped at the point of charging. The principal's answers (29 Sept
-- 2026): changes are blocked without approval; tuition, activity,
-- technology and medical are locked; term fees differ by year group.
-- Damages, Tuckshop and discounts stay free to charge at any amount.
--
-- How it works:
--   * fee_items.price_locked marks the locked items. It is set here from
--     the category (tuition, activity, technology, medical, any case) and
--     can't be changed from the app (guard_fee_prices(), extended): a
--     locked item can't quietly be unlocked to get round approval.
--   * fee_item_year_prices holds the approved price of a locked item for
--     each year group 7-12. The app can only read it. It is written only
--     when a 'fee_item_prices' proposal (one per item, all six year groups
--     together, so one approval covers the item) is approved by both, via
--     propose_fee_item_year_prices() and approve_fee_price_change().
--   * enforce_locked_fee_price(), a BEFORE INSERT OR UPDATE trigger on
--     invoice_line_items, checks every line for a locked item, however it
--     is added (Charge Checklist, apply_fee_charge_batch(), a direct insert
--     by the bursar): the amount must equal the approved price for the
--     student's current year group, or, where no year price is set, the
--     item's approved single price. With neither, the charge is refused.
--     Only a change made directly in the SQL editor (session_user postgres,
--     the principal's own route) is exempt.
--   * No year prices exist yet, so until they are proposed and approved,
--     locked items can be charged only at their approved single price (if
--     any). Charges already on invoices are not touched.

set local formwork.change_note = 'Principal (direct)';

-- 1. Which items are locked ------------------------------------------------------

alter table public.fee_items add column if not exists price_locked boolean not null default false;

update public.fee_items
   set price_locked = true
 where lower(btrim(category)) in ('tuition', 'activity', 'technology', 'medical');

comment on column public.fee_items.price_locked is
  'Charged only at the approved price for the student''s year group (migration 260). Set in SQL, not from the app.';

-- 2. Year-group prices -----------------------------------------------------------

create table if not exists public.fee_item_year_prices (
  fee_item_id bigint not null references public.fee_items(id),
  year_group integer not null check (year_group between 7 and 12),
  amount numeric(12,2) not null check (amount >= 0),
  approved_change_id bigint references public.fee_price_changes(id),
  primary key (fee_item_id, year_group)
);

comment on table public.fee_item_year_prices is
  'Approved price of a locked fee item for each year group (migration 260). Written only when both the principal and the college secretary approve a fee_item_prices proposal.';

alter table public.fee_item_year_prices enable row level security;
grant select on public.fee_item_year_prices to authenticated;

create policy "Fee item year prices readable by fee staff and approvers"
  on public.fee_item_year_prices for select to authenticated
  using (can_propose_fee_prices());

create trigger trg_log_change after insert or update or delete on public.fee_item_year_prices
  for each row execute function public.log_change('fees', 'fee_item_id,year_group');

-- 3. Proposals for year prices ---------------------------------------------------

alter table public.fee_price_changes drop constraint if exists fee_price_changes_kind_check;
alter table public.fee_price_changes add constraint fee_price_changes_kind_check
  check (kind in ('admission_fees', 'fee_item', 'fee_item_prices'));

alter table public.fee_price_changes drop constraint if exists fee_price_changes_target;
alter table public.fee_price_changes add constraint fee_price_changes_target check (
  (kind = 'admission_fees' and academic_year_id is not null and fee_item_id is null)
  or (kind in ('fee_item', 'fee_item_prices') and fee_item_id is not null and academic_year_id is null));

create unique index if not exists fee_price_changes_one_pending_item_years
  on public.fee_price_changes (fee_item_id) where status = 'pending' and kind = 'fee_item_prices';

-- p_prices: {"7": 350000, "8": 350000, ..., "12": null}; null (or a missing
-- key) means no price for that year group.
create or replace function public.propose_fee_item_year_prices(p_fee_item_id bigint, p_prices jsonb, p_reason text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
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
    raise exception '% isn''t charged by year-group price.', coalesce(f.display_name, f.name);
  end if;
  for v_yg in 7..12 loop
    v_amount := nullif(p_prices->>v_yg::text, '')::numeric;
    if v_amount < 0 then
      raise exception 'Amounts can''t be negative.';
    end if;
    v_new := v_new || jsonb_build_object(v_yg::text, v_amount);
    v_old := v_old || jsonb_build_object(v_yg::text,
      (select amount from fee_item_year_prices where fee_item_id = p_fee_item_id and year_group = v_yg));
  end loop;
  if v_new = v_old then
    raise exception 'Those are already the prices.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'fee_item_prices' and fee_item_id = p_fee_item_id and status = 'pending') then
    raise exception 'Year prices for % are already waiting for approval. Approve, reject or cancel them first.', coalesce(f.display_name, f.name);
  end if;

  insert into fee_price_changes (kind, fee_item_id, old_values, new_values, reason, requested_by)
  values ('fee_item_prices', p_fee_item_id, v_old, v_new, nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Same as migration 259, plus applying 'fee_item_prices'.
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

-- 4. Locked items can't be unlocked from the app ----------------------------------

create or replace function public.guard_fee_prices()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'academic_years' then
    if tg_op = 'INSERT' and (new.admission_form_fee is not null or new.admission_deposit is not null)
       or tg_op = 'UPDATE' and (new.admission_form_fee is distinct from old.admission_form_fee
                                or new.admission_deposit is distinct from old.admission_deposit) then
      raise exception 'Admission fees change only when the principal and the college secretary have both approved. Propose the change at Fee Approvals.';
    end if;
  elsif tg_table_name = 'fee_items' then
    if tg_op = 'INSERT' and new.default_amount is not null
       or tg_op = 'UPDATE' and new.default_amount is distinct from old.default_amount then
      raise exception 'Fee prices change only when the principal and the college secretary have both approved. Propose the price at Fee Approvals.';
    end if;
    if tg_op = 'INSERT' and new.price_locked
       or tg_op = 'UPDATE' and new.price_locked is distinct from old.price_locked then
      raise exception 'Whether a fee is locked to its approved price is set by the principal, not from this page.';
    end if;
    -- The lock follows the category, so re-labelling an item mustn't
    -- unlock it either.
    if tg_op = 'UPDATE' and old.price_locked and new.category is distinct from old.category then
      raise exception 'A locked fee item''s category can''t be changed from this page.';
    end if;
  end if;
  return new;
end;
$$;

-- 5. Charges for locked items must match the approved price -----------------------

create or replace function public.enforce_locked_fee_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
  v_year integer;
  v_price numeric;
begin
  if new.fee_item_id is null or session_user = 'postgres' then
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

  select s.year_group into v_year
    from student_invoices si join students s on s.student_id = si.student_id
   where si.id = new.invoice_id;
  select amount into v_price from fee_item_year_prices
   where fee_item_id = f.id and year_group = v_year;
  v_price := coalesce(v_price, f.default_amount);

  if v_price is null then
    raise exception '% has no approved price for Year %. It must be approved by the principal and the college secretary before it can be charged.',
      coalesce(f.display_name, f.name), v_year;
  end if;
  if new.amount is distinct from v_price then
    raise exception '% is charged at its approved price for Year %: %. Other amounts need approval first.',
      coalesce(f.display_name, f.name), v_year, to_char(v_price, 'FM999,999,990.00');
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_locked_fee_price() from public, anon, authenticated;

drop trigger if exists trg_enforce_locked_fee_price on public.invoice_line_items;
create trigger trg_enforce_locked_fee_price before insert or update on public.invoice_line_items
  for each row execute function public.enforce_locked_fee_price();

-- 6. The list shows year-price proposals by name as before ------------------------
-- (fee_price_change_list() already joins fee_items on fee_item_id, so
-- 'fee_item_prices' rows come through with the item's name unchanged.)
