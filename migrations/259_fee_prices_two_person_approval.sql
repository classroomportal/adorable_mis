-- Migration 259: fee prices need the principal AND the college secretary.
--
-- Why: the principal's rule (29 Sept 2026): "fees for anything like
-- admissions or term fees are set and approved by the principal and college
-- secretary together". Until now the bursar alone could change a fee item's
-- price (fee_items.default_amount), and the bursar or anyone with Lookups
-- could change the admission form price and deposit (migration 258).
--
-- How it works now:
--   * Two new staff roles: 'principal' (principal@) and 'college_secretary'
--     (cs@, the principal's answer). They are checked in staff_roles
--     directly, not through is_admin(): being admin is not enough to
--     approve as either of them (as with tuckshop_owner, migration 229).
--   * A price change is a row in fee_price_changes: proposed by the bursar,
--     SMT, the principal, the college secretary, or anyone with Lookups,
--     through propose_admission_fees() or propose_fee_item_price(). It
--     changes nothing until approved.
--   * approve_fee_price_change() records the caller's approval in the slot
--     for the role they hold. The two slots must be filled by two different
--     people. When both are filled, the new price is applied at once.
--     Either approver can reject_fee_price_change() with a note; whoever
--     proposed it can cancel_fee_price_change() while it is pending.
--   * The prices themselves can no longer be written by the app:
--     guard_fee_prices() rejects any change to academic_years'
--     admission_form_fee / admission_deposit, or to fee_items.default_amount
--     (including a new item created with a price), coming from
--     'authenticated' (the current_user test of migrations 151 and 256).
--     Only the approval function, running as its owner, can change them.
--     set_admission_fee_amounts() (migrations 256, 258) is dropped.
--   * Every proposal, approval, rejection and cancellation is logged in
--     change_history under 'fees', and the rows are kept for good (no
--     delete from the app).
--
-- Not covered yet (a separate decision): the bursar's Charge Checklist
-- starts from the item's price but still lets any amount be typed, per year
-- group. Making charges use only approved prices changes how the bursar
-- works mid-term and is left for the principal to decide.
--
-- The ₦100,000 deposit set by migration 258 stays as it is (set on the
-- principal's instruction); later changes go through approval.

set local formwork.change_note = 'Principal (direct)';

-- 1. The two roles ------------------------------------------------------------

insert into public.roles (role_name, description) values
  ('principal', 'The principal. Approves fee prices together with the college secretary (migration 259).'),
  ('college_secretary', 'The college secretary. Approves fee prices together with the principal (migration 259).')
on conflict (role_name) do nothing;

insert into public.staff_roles (staff_id, role_name)
select st.staff_id, 'principal' from public.staff st where lower(btrim(st.email)) = 'principal@abc.sch.ng'
on conflict do nothing;

insert into public.staff_roles (staff_id, role_name)
select st.staff_id, 'college_secretary' from public.staff st where lower(btrim(st.email)) = 'cs@abc.sch.ng'
on conflict do nothing;

-- Holds this exact staff role; admin does not count.
create or replace function public.holds_staff_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid() and sr.role_name = p_role);
$$;

create or replace function public.can_propose_fee_prices()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select user_has_staff_role(array['bursar', 'smt', 'principal', 'college_secretary'])
      or has_resource_access('/admin/lookups');
$$;

-- 2. Proposals ----------------------------------------------------------------

create table if not exists public.fee_price_changes (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('admission_fees', 'fee_item')),
  academic_year_id integer references public.academic_years(academic_year_id),
  fee_item_id bigint references public.fee_items(id),
  old_values jsonb not null,
  new_values jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  principal_approved_by uuid,
  principal_approved_at timestamptz,
  secretary_approved_by uuid,
  secretary_approved_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  close_note text,
  constraint fee_price_changes_target check (
    (kind = 'admission_fees' and academic_year_id is not null and fee_item_id is null)
    or (kind = 'fee_item' and fee_item_id is not null and academic_year_id is null)),
  constraint fee_price_changes_two_people check (
    principal_approved_by is null or secretary_approved_by is null
    or principal_approved_by <> secretary_approved_by)
);

-- One open proposal per price at a time.
create unique index if not exists fee_price_changes_one_pending_year
  on public.fee_price_changes (academic_year_id) where status = 'pending' and kind = 'admission_fees';
create unique index if not exists fee_price_changes_one_pending_item
  on public.fee_price_changes (fee_item_id) where status = 'pending' and kind = 'fee_item';

comment on table public.fee_price_changes is
  'Proposed fee price changes (migration 259). A price changes only when both the principal and the college secretary (two different people) have approved. Written only by the propose/approve/reject/cancel functions.';

alter table public.fee_price_changes enable row level security;
grant select on public.fee_price_changes to authenticated;

create policy "Fee price changes readable by fee staff and approvers"
  on public.fee_price_changes for select to authenticated
  using (can_propose_fee_prices());

create trigger trg_log_change after insert or update or delete on public.fee_price_changes
  for each row execute function public.log_change('fees', 'id');

-- 3. The prices can only change through approval ------------------------------

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
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_fee_prices() from public, anon, authenticated;

drop trigger if exists trg_guard_fee_prices on public.academic_years;
create trigger trg_guard_fee_prices before insert or update on public.academic_years
  for each row execute function public.guard_fee_prices();
drop trigger if exists trg_guard_fee_prices on public.fee_items;
create trigger trg_guard_fee_prices before insert or update on public.fee_items
  for each row execute function public.guard_fee_prices();

drop function if exists public.set_admission_fee_amounts(integer, numeric, numeric);

-- 4. Propose, approve, reject, cancel ------------------------------------------

create or replace function public.propose_admission_fees(p_academic_year_id integer, p_form_fee numeric, p_deposit numeric, p_reason text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  y academic_years;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if p_form_fee < 0 or p_deposit < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  if p_form_fee is not distinct from y.admission_form_fee and p_deposit is not distinct from y.admission_deposit then
    raise exception 'Those are already the amounts.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'admission_fees' and academic_year_id = p_academic_year_id and status = 'pending') then
    raise exception 'A change to % admission fees is already waiting for approval. Approve, reject or cancel it first.', y.label;
  end if;

  insert into fee_price_changes (kind, academic_year_id, old_values, new_values, reason, requested_by)
  values ('admission_fees', p_academic_year_id,
          jsonb_build_object('form_fee', y.admission_form_fee, 'deposit', y.admission_deposit),
          jsonb_build_object('form_fee', p_form_fee, 'deposit', p_deposit),
          nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.propose_fee_item_price(p_fee_item_id bigint, p_amount numeric, p_reason text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  f fee_items;
  v_id bigint;
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t propose fee changes.';
  end if;
  select * into f from fee_items where id = p_fee_item_id;
  if f.id is null then
    raise exception 'Fee item not found.';
  end if;
  if p_amount < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  if p_amount is not distinct from f.default_amount then
    raise exception 'That is already the price.';
  end if;
  if exists (select 1 from fee_price_changes where kind = 'fee_item' and fee_item_id = p_fee_item_id and status = 'pending') then
    raise exception 'A price change for % is already waiting for approval. Approve, reject or cancel it first.', coalesce(f.display_name, f.name);
  end if;

  insert into fee_price_changes (kind, fee_item_id, old_values, new_values, reason, requested_by)
  values ('fee_item', p_fee_item_id,
          jsonb_build_object('amount', f.default_amount),
          jsonb_build_object('amount', p_amount),
          nullif(btrim(p_reason), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

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

  -- Both in: apply. This function runs as its owner, so guard_fee_prices()
  -- lets the change through.
  if c.kind = 'admission_fees' then
    update academic_years
       set admission_form_fee = (c.new_values->>'form_fee')::numeric,
           admission_deposit = (c.new_values->>'deposit')::numeric
     where academic_year_id = c.academic_year_id;
  else
    update fee_items set default_amount = (c.new_values->>'amount')::numeric where id = c.fee_item_id;
  end if;
  update fee_price_changes set status = 'approved', closed_at = now() where id = p_id;
  return 'applied';
end;
$$;

create or replace function public.reject_fee_price_change(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (holds_staff_role('principal') or holds_staff_role('college_secretary')) then
    raise exception 'Only the principal and the college secretary can reject fee prices.';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why it is rejected.';
  end if;
  update fee_price_changes
     set status = 'rejected', closed_by = auth.uid(), closed_at = now(), close_note = btrim(p_note)
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'Only a change still waiting for approval can be rejected.';
  end if;
end;
$$;

create or replace function public.cancel_fee_price_change(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update fee_price_changes
     set status = 'cancelled', closed_by = auth.uid(), closed_at = now()
   where id = p_id and status = 'pending'
     and (requested_by = auth.uid() or holds_staff_role('principal') or holds_staff_role('college_secretary'));
  if not found then
    raise exception 'Only whoever proposed it (or an approver) can cancel a change still waiting for approval.';
  end if;
end;
$$;

-- Proposals with names, for the Fee Approvals page (profiles aren't readable
-- across staff, so the names come from profile_display_name() here).
create or replace function public.fee_price_change_list()
returns table (
  id bigint, kind text, academic_year_id integer, year_label text,
  fee_item_id bigint, fee_item_name text, old_values jsonb, new_values jsonb,
  reason text, status text, requested_at timestamptz, requested_by_name text,
  principal_approved_at timestamptz, principal_name text,
  secretary_approved_at timestamptz, secretary_name text,
  closed_at timestamptz, closed_by_name text, close_note text, mine boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_propose_fee_prices() then
    raise exception 'You can''t see fee approvals.';
  end if;
  return query
  select c.id, c.kind, c.academic_year_id, y.label,
         c.fee_item_id, coalesce(f.display_name, f.name), c.old_values, c.new_values,
         c.reason, c.status, c.requested_at, profile_display_name(c.requested_by),
         c.principal_approved_at, profile_display_name(c.principal_approved_by),
         c.secretary_approved_at, profile_display_name(c.secretary_approved_by),
         c.closed_at, profile_display_name(c.closed_by), c.close_note,
         c.requested_by = auth.uid()
    from fee_price_changes c
    left join academic_years y on y.academic_year_id = c.academic_year_id
    left join fee_items f on f.id = c.fee_item_id
   order by (c.status = 'pending') desc, c.requested_at desc
   limit 200;
end;
$$;

-- Which approver roles the caller holds, so the page shows the right buttons
-- (the approve/reject functions check again).
create or replace function public.my_fee_approver_roles()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select array_remove(array[
    case when holds_staff_role('principal') then 'principal' end,
    case when holds_staff_role('college_secretary') then 'college_secretary' end], null);
$$;

-- 5. The page ------------------------------------------------------------------

insert into resources (resource_key, label, section, sort_order) values
  ('/bursar/fee-approvals', 'Fee Approvals', 'Fees & Bills', 5)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('bursar', '/bursar/fee-approvals'),
  ('smt', '/bursar/fee-approvals'),
  ('principal', '/bursar/fee-approvals'),
  ('college_secretary', '/bursar/fee-approvals')
on conflict do nothing;
