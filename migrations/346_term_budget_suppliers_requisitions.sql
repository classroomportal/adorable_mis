-- Migration 346: term budgets, contingency releases, approved suppliers and
-- requisitions (budgets phases 2-4, as a working draft), with practice entries.
--
-- Why: the principal, 3 Oct 2026: "I want to have draft ready but show the
-- process to CS and how things are connected. So all links must be ready."
-- Decisions that day: the principal alone has access while it is built and
-- will show the college secretary on screen; anything entered now is
-- practice ("Draft - practice"), never counted in real totals, and cleared in
-- one recorded step before go-live. The process and rules are those agreed in
-- docs/finance-budget-design.md (2-3 Oct 2026).
--
-- What it adds (all written only through the functions below; the tables
-- have select policies only, so nothing can be written or deleted directly):
--   * term_budgets / term_budget_lines: a term's allocation to each cost
--     centre (except the general fund and the tuck shop). Proposed by the
--     principal or the college secretary, applied when both have approved
--     (two different people); approving it supersedes the term's previous
--     approved budget. Cancelled, never deleted.
--   * contingency_releases: money moved from Contingency to a cost centre
--     that would otherwise overspend, with a reason and the requisition that
--     needed it. The principal alone releases (agreed 3 Oct).
--   * suppliers: the approved suppliers list. Proposed by the principal, the
--     college secretary or the bursar; approved by the principal and the
--     college secretary together. Changing bank details sends it back for
--     approval. Suspended or archived, never deleted. Bank details are seen
--     only by those who see the budget.
--   * requisitions / requisition_items / requisition_events /
--     requisition_payments: raised by any member of staff; signed by the
--     principal; costed (approved supplier, prices, cost centre) and approved
--     by the college secretary, which commits the money; supplied (the
--     requester records delivery); paid by the bursar, never more than the
--     approved total. Approval is refused beyond the cost centre's remaining
--     budget (it waits for a contingency release instead) and, for real
--     entries, beyond the cash collected for the term ("invoiced, spend to
--     cash"). Nobody signs or approves their own requisition: the principal's
--     own count as signed when raised; the college secretary's own are
--     approved by the principal. Every step is a timeline event.
--   * practice: every row carries `practice`. Practice and real entries are
--     never mixed (a practice requisition can only use practice budgets,
--     suppliers and releases, and the reverse). In practice the principal may
--     do every step (the college secretary's and the bursar's too) and one
--     approval completes a budget or a supplier, so the whole process can be
--     shown by one person. clear_practice_entries() cancels or archives all
--     practice entries, recorded, never deleted.
--   * budget_position(term, practice): per cost centre, allocated (approved
--     budget plus releases), committed (approved, not yet paid), spent
--     (paid), remaining; and the term's cash collected.
--   * Logged in change_history under 'finance'. Who-did-it columns are set
--     from auth.uid() inside the functions, never taken from the request.

set local formwork.change_note = 'Principal (direct)';

-- 0. Helpers --------------------------------------------------------------------

create or replace function public.finance_staff_id()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select staff_id from profiles where id = auth.uid();
$$;
revoke execute on function public.finance_staff_id() from public, anon;
grant execute on function public.finance_staff_id() to authenticated;

-- In practice the principal may act for anyone; otherwise the named role.
create or replace function public.finance_can_act(p_role text, p_practice boolean)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select holds_staff_role(p_role) or (p_practice and holds_staff_role('principal'));
$$;
revoke execute on function public.finance_can_act(text, boolean) from public, anon;
grant execute on function public.finance_can_act(text, boolean) to authenticated;

-- 1. Term budgets --------------------------------------------------------------

create table public.term_budgets (
  id bigint generated always as identity primary key,
  term_id integer not null references public.terms(term_id),
  practice boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'superseded', 'cancelled')),
  note text,
  proposed_by uuid,
  proposed_at timestamptz not null default now(),
  principal_approved_by uuid,
  principal_approved_at timestamptz,
  secretary_approved_by uuid,
  secretary_approved_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  close_note text
);
create unique index term_budgets_one_pending on public.term_budgets (term_id, practice) where status = 'pending';
create unique index term_budgets_one_approved on public.term_budgets (term_id, practice) where status = 'approved';

create table public.term_budget_lines (
  id bigint generated always as identity primary key,
  term_budget_id bigint not null references public.term_budgets(id),
  cost_centre_id bigint not null references public.cost_centres(id),
  amount numeric(14,2) not null check (amount >= 0)
);
create unique index term_budget_lines_one on public.term_budget_lines (term_budget_id, cost_centre_id);

-- 2. Contingency releases -------------------------------------------------------

create table public.contingency_releases (
  id bigint generated always as identity primary key,
  term_id integer not null references public.terms(term_id),
  practice boolean not null default false,
  cost_centre_id bigint not null references public.cost_centres(id),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null,
  requisition_id bigint,
  released_by uuid,
  released_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_note text
);

-- 3. Suppliers -----------------------------------------------------------------

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  practice boolean not null default false,
  supplies text,
  contact_name text,
  phone text,
  email text,
  bank_name text,
  account_name text,
  account_number text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'suspended', 'archived')),
  proposed_by uuid,
  proposed_at timestamptz not null default now(),
  principal_approved_by uuid,
  principal_approved_at timestamptz,
  secretary_approved_by uuid,
  secretary_approved_at timestamptz,
  status_changed_by uuid,
  status_changed_at timestamptz,
  status_note text
);
create unique index suppliers_name_unique on public.suppliers (practice, lower(btrim(name)));

-- 4. Requisitions --------------------------------------------------------------

create table public.requisitions (
  id bigint generated always as identity primary key,
  term_id integer not null references public.terms(term_id),
  practice boolean not null default false,
  requested_by uuid not null,
  requester_staff_id integer,
  cost_centre_id bigint references public.cost_centres(id),
  supplier_id bigint references public.suppliers(id),
  reason text not null,
  needed_by date,
  status text not null default 'submitted' check (status in
    ('submitted', 'signed', 'costed', 'awaiting_release', 'approved', 'part_received', 'received', 'paid', 'rejected', 'cancelled')),
  total numeric(14,2),
  paid_total numeric(14,2) not null default 0,
  raised_at timestamptz not null default now(),
  signed_by uuid, signed_at timestamptz,
  costed_by uuid, costed_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  closed_by uuid, closed_at timestamptz, close_note text
);
alter table public.contingency_releases
  add constraint contingency_releases_requisition_fk foreign key (requisition_id) references public.requisitions(id);

create table public.requisition_items (
  id bigint generated always as identity primary key,
  requisition_id bigint not null references public.requisitions(id),
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit text,
  unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  quantity_received numeric(12,2) not null default 0 check (quantity_received >= 0)
);

create table public.requisition_events (
  id bigint generated always as identity primary key,
  requisition_id bigint not null references public.requisitions(id),
  event text not null,
  note text,
  done_by uuid,
  done_by_name text,
  done_at timestamptz not null default now()
);

create table public.requisition_payments (
  id bigint generated always as identity primary key,
  requisition_id bigint not null references public.requisitions(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text,
  reference text,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);

-- 5. Read rules, grants, logging -------------------------------------------------

alter table public.term_budgets enable row level security;
alter table public.term_budget_lines enable row level security;
alter table public.contingency_releases enable row level security;
alter table public.suppliers enable row level security;
alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_events enable row level security;
alter table public.requisition_payments enable row level security;

grant select on public.term_budgets, public.term_budget_lines, public.contingency_releases, public.suppliers,
  public.requisitions, public.requisition_items, public.requisition_events, public.requisition_payments to authenticated;

create policy term_budgets_read on public.term_budgets for select to authenticated using (can_view_budget());
create policy term_budget_lines_read on public.term_budget_lines for select to authenticated using (can_view_budget());
create policy contingency_releases_read on public.contingency_releases for select to authenticated using (can_view_budget());
create policy suppliers_read on public.suppliers for select to authenticated using (can_view_budget());
-- Requesters see their own requisitions and their timeline; the budget sees all.
create policy requisitions_read on public.requisitions for select to authenticated
  using (can_view_budget() or requested_by = auth.uid());
create policy requisition_items_read on public.requisition_items for select to authenticated
  using (exists (select 1 from requisitions r where r.id = requisition_id and (can_view_budget() or r.requested_by = auth.uid())));
create policy requisition_events_read on public.requisition_events for select to authenticated
  using (exists (select 1 from requisitions r where r.id = requisition_id and (can_view_budget() or r.requested_by = auth.uid())));
create policy requisition_payments_read on public.requisition_payments for select to authenticated using (can_view_budget());

create trigger trg_log_change after insert or update or delete on public.term_budgets for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.term_budget_lines for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.contingency_releases for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.suppliers for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.requisitions for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.requisition_items for each row execute function public.log_change('finance', 'id');
create trigger trg_log_change after insert or update or delete on public.requisition_payments for each row execute function public.log_change('finance', 'id');

-- 6. Where the money stands -------------------------------------------------------

-- Cash collected for a term: every in-budget fund's share of payments on
-- invoices of the fee terms linked to that school term.
create or replace function public.term_cash_collected(p_term_id integer)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(sum(a.amount), 0)
  from fee_payment_allocations a
  join fee_payments p on p.id = a.payment_id
  join student_invoices si on si.id = p.invoice_id
  join fee_terms ft on ft.id = si.term_id
  left join cost_centres c on c.id = a.cost_centre_id
  where ft.term_id = p_term_id and coalesce(c.kind, '') <> 'held';
$$;
revoke execute on function public.term_cash_collected(integer) from public, anon, authenticated;

create or replace function public.budget_position(p_term_id integer, p_practice boolean)
returns table (
  cost_centre_id bigint, name text, kind text, sort_order integer,
  allocated numeric, released_in numeric, released_out numeric,
  committed numeric, spent numeric, remaining numeric, cash_collected numeric
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
  with b as (
    select l.cost_centre_id as cc, sum(l.amount) as amt
    from term_budget_lines l join term_budgets tb on tb.id = l.term_budget_id
    where tb.term_id = p_term_id and tb.practice = p_practice and tb.status = 'approved'
    group by 1
  ), rin as (
    select cr.cost_centre_id as cc, sum(cr.amount) as amt from contingency_releases cr
    where cr.term_id = p_term_id and cr.practice = p_practice and cr.cancelled_at is null group by 1
  ), rout as (
    select sum(cr.amount) as amt from contingency_releases cr
    where cr.term_id = p_term_id and cr.practice = p_practice and cr.cancelled_at is null
  ), req as (
    select r.cost_centre_id as cc,
           sum(case when r.status in ('approved', 'part_received', 'received') then greatest(r.total - r.paid_total, 0) else 0 end) as committed,
           sum(r.paid_total) as spent
    from requisitions r
    where r.term_id = p_term_id and r.practice = p_practice and r.cost_centre_id is not null
      and r.status not in ('rejected', 'submitted', 'signed', 'costed', 'awaiting_release')
    group by 1
  ), cash as (select term_cash_collected(p_term_id) as amt)
  select c.id, c.name, c.kind, c.sort_order,
         coalesce(b.amt, 0)::numeric,
         coalesce(rin.amt, 0)::numeric,
         case when c.kind = 'contingency' then coalesce((select amt from rout), 0) else 0 end::numeric,
         coalesce(req.committed, 0)::numeric,
         coalesce(req.spent, 0)::numeric,
         (coalesce(b.amt, 0) + coalesce(rin.amt, 0)
           - case when c.kind = 'contingency' then coalesce((select amt from rout), 0) else 0 end
           - coalesce(req.committed, 0) - coalesce(req.spent, 0))::numeric,
         (select amt from cash)::numeric
  from cost_centres c
  left join b on b.cc = c.id
  left join rin on rin.cc = c.id
  left join req on req.cc = c.id
  where c.kind not in ('general_pool', 'held') and (c.active or b.amt is not null or req.cc is not null)
  order by c.sort_order, c.name;
end;
$$;
revoke execute on function public.budget_position(integer, boolean) from public, anon;
grant execute on function public.budget_position(integer, boolean) to authenticated;

-- Remaining for one cost centre, used by the approval checks.
create or replace function public.cost_centre_remaining(p_term_id integer, p_practice boolean, p_cost_centre_id bigint)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    coalesce((select sum(l.amount) from term_budget_lines l join term_budgets tb on tb.id = l.term_budget_id
              where tb.term_id = p_term_id and tb.practice = p_practice and tb.status = 'approved'
                and l.cost_centre_id = p_cost_centre_id), 0)
  + coalesce((select sum(amount) from contingency_releases
              where term_id = p_term_id and practice = p_practice and cancelled_at is null
                and cost_centre_id = p_cost_centre_id), 0)
  - case when (select kind from cost_centres where id = p_cost_centre_id) = 'contingency'
         then coalesce((select sum(amount) from contingency_releases
                        where term_id = p_term_id and practice = p_practice and cancelled_at is null), 0)
         else 0 end
  - coalesce((select sum(case when status in ('approved', 'part_received', 'received') then greatest(total - paid_total, 0) else 0 end
                     + paid_total)
              from requisitions
              where term_id = p_term_id and practice = p_practice and cost_centre_id = p_cost_centre_id
                and status in ('approved', 'part_received', 'received', 'paid', 'cancelled')), 0);
$$;
revoke execute on function public.cost_centre_remaining(integer, boolean, bigint) from public, anon, authenticated;

-- 7. Term budget functions ---------------------------------------------------------

-- p_lines: {"<cost_centre_id>": amount, ...}
create or replace function public.propose_term_budget(p_term_id integer, p_lines jsonb, p_practice boolean, p_note text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id bigint;
  v_key text;
  v_amount numeric;
begin
  if not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can propose a term budget.';
  end if;
  if not exists (select 1 from terms where term_id = p_term_id) then
    raise exception 'Term not found.';
  end if;
  if exists (select 1 from term_budgets where term_id = p_term_id and practice = p_practice and status = 'pending') then
    raise exception 'A budget for this term is already waiting for approval. Approve or cancel it first.';
  end if;
  insert into term_budgets (term_id, practice, note, proposed_by)
  values (p_term_id, p_practice, nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;
  for v_key in select jsonb_object_keys(coalesce(p_lines, '{}'::jsonb)) loop
    v_amount := nullif(p_lines->>v_key, '')::numeric;
    if v_amount is null or v_amount = 0 then
      continue;
    end if;
    if v_amount < 0 then
      raise exception 'Amounts can''t be negative.';
    end if;
    if not exists (select 1 from cost_centres where id = v_key::bigint and kind not in ('general_pool', 'held')) then
      raise exception 'Budgets go to cost centres, not to the general fund or the tuck shop.';
    end if;
    insert into term_budget_lines (term_budget_id, cost_centre_id, amount) values (v_id, v_key::bigint, v_amount);
  end loop;
  return v_id;
end;
$$;

create or replace function public.approve_term_budget(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  b term_budgets;
  v_principal boolean := holds_staff_role('principal');
  v_secretary boolean := holds_staff_role('college_secretary');
begin
  select * into b from term_budgets where id = p_id for update;
  if b.id is null then
    raise exception 'Budget not found.';
  end if;
  if b.status <> 'pending' then
    raise exception 'This budget is already %.', b.status;
  end if;
  if not (v_principal or v_secretary) then
    raise exception 'Only the principal and the college secretary approve a term budget.';
  end if;
  if auth.uid() in (b.principal_approved_by, b.secretary_approved_by) then
    raise exception 'You have already approved this budget. It needs the other approver.';
  end if;
  if v_principal and b.principal_approved_by is null then
    update term_budgets set principal_approved_by = auth.uid(), principal_approved_at = now() where id = p_id;
  elsif v_secretary and b.secretary_approved_by is null then
    update term_budgets set secretary_approved_by = auth.uid(), secretary_approved_at = now() where id = p_id;
  end if;
  select * into b from term_budgets where id = p_id;
  -- Practice: one approval completes it, so one person can show the process.
  if not b.practice and (b.principal_approved_by is null or b.secretary_approved_by is null) then
    return 'waiting';
  end if;
  update term_budgets set status = 'superseded', closed_by = auth.uid(), closed_at = now(), close_note = 'Replaced by a newer approved budget'
  where term_id = b.term_id and practice = b.practice and status = 'approved';
  update term_budgets set status = 'approved' where id = p_id;
  return 'approved';
end;
$$;

create or replace function public.cancel_term_budget(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can cancel a term budget.';
  end if;
  update term_budgets set status = 'cancelled', closed_by = auth.uid(), closed_at = now(), close_note = nullif(btrim(p_note), '')
  where id = p_id and status = 'pending';
  if not found then
    raise exception 'Only a budget waiting for approval can be cancelled.';
  end if;
end;
$$;

-- 8. Contingency releases -----------------------------------------------------------

create or replace function public.release_contingency(
  p_term_id integer, p_cost_centre_id bigint, p_amount numeric, p_reason text, p_requisition_id bigint, p_practice boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_contingency bigint;
  v_left numeric;
  v_id bigint;
begin
  if not holds_staff_role('principal') then
    raise exception 'Only the principal releases money from contingency.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Give an amount to release.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give the reason for the release.';
  end if;
  if not exists (select 1 from cost_centres where id = p_cost_centre_id and kind in ('allocated', 'ring_fenced')) then
    raise exception 'Money is released to an allocated or ring-fenced cost centre.';
  end if;
  if p_requisition_id is not null and not exists (
       select 1 from requisitions where id = p_requisition_id and practice = p_practice and term_id = p_term_id) then
    raise exception 'That requisition isn''t in this term''s % entries.', case when p_practice then 'practice' else 'real' end;
  end if;
  select id into v_contingency from cost_centres where kind = 'contingency';
  v_left := cost_centre_remaining(p_term_id, p_practice, v_contingency);
  if p_amount > v_left then
    raise exception 'Contingency has only % left for this term. Move money into it with a budget change first.', to_char(v_left, 'FM999,999,990');
  end if;
  insert into contingency_releases (term_id, practice, cost_centre_id, amount, reason, requisition_id, released_by)
  values (p_term_id, p_practice, p_cost_centre_id, p_amount, btrim(p_reason), p_requisition_id, auth.uid())
  returning id into v_id;
  if p_requisition_id is not null then
    insert into requisition_events (requisition_id, event, note, done_by, done_by_name)
    values (p_requisition_id, 'Contingency released', to_char(p_amount, 'FM999,999,990') || ': ' || btrim(p_reason),
            auth.uid(), profile_display_name(auth.uid()));
  end if;
  return v_id;
end;
$$;

-- 9. Suppliers -----------------------------------------------------------------------

create or replace function public.propose_supplier(p_supplier jsonb, p_practice boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id bigint;
begin
  if not (is_budget_approver() or holds_staff_role('bursar')) then
    raise exception 'Only the principal, the college secretary or the bursar can propose a supplier.';
  end if;
  if coalesce(btrim(p_supplier->>'name'), '') = '' then
    raise exception 'Give the supplier''s name.';
  end if;
  insert into suppliers (name, practice, supplies, contact_name, phone, email, bank_name, account_name, account_number, proposed_by)
  values (btrim(p_supplier->>'name'), p_practice, nullif(btrim(p_supplier->>'supplies'), ''),
          nullif(btrim(p_supplier->>'contact_name'), ''), nullif(btrim(p_supplier->>'phone'), ''),
          nullif(btrim(p_supplier->>'email'), ''), nullif(btrim(p_supplier->>'bank_name'), ''),
          nullif(btrim(p_supplier->>'account_name'), ''), nullif(btrim(p_supplier->>'account_number'), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Contact details can change freely; a change to bank details sends an
-- approved supplier back for approval (the usual route for payment fraud).
create or replace function public.update_supplier(p_id bigint, p_supplier jsonb)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s suppliers;
  v_bank_changed boolean;
begin
  if not (is_budget_approver() or holds_staff_role('bursar')) then
    raise exception 'Only the principal, the college secretary or the bursar can change a supplier.';
  end if;
  select * into s from suppliers where id = p_id for update;
  if s.id is null then
    raise exception 'Supplier not found.';
  end if;
  v_bank_changed := coalesce(nullif(btrim(p_supplier->>'bank_name'), ''), '') is distinct from coalesce(s.bank_name, '')
    or coalesce(nullif(btrim(p_supplier->>'account_name'), ''), '') is distinct from coalesce(s.account_name, '')
    or coalesce(nullif(btrim(p_supplier->>'account_number'), ''), '') is distinct from coalesce(s.account_number, '');
  update suppliers set
    name = coalesce(nullif(btrim(p_supplier->>'name'), ''), s.name),
    supplies = nullif(btrim(p_supplier->>'supplies'), ''),
    contact_name = nullif(btrim(p_supplier->>'contact_name'), ''),
    phone = nullif(btrim(p_supplier->>'phone'), ''),
    email = nullif(btrim(p_supplier->>'email'), ''),
    bank_name = nullif(btrim(p_supplier->>'bank_name'), ''),
    account_name = nullif(btrim(p_supplier->>'account_name'), ''),
    account_number = nullif(btrim(p_supplier->>'account_number'), '')
  where id = p_id;
  if v_bank_changed and s.status = 'approved' then
    update suppliers set status = 'proposed', principal_approved_by = null, principal_approved_at = null,
      secretary_approved_by = null, secretary_approved_at = null,
      status_changed_by = auth.uid(), status_changed_at = now(), status_note = 'Bank details changed: needs approval again'
    where id = p_id;
    return 'needs approval again';
  end if;
  return 'saved';
end;
$$;

create or replace function public.approve_supplier(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s suppliers;
  v_principal boolean := holds_staff_role('principal');
  v_secretary boolean := holds_staff_role('college_secretary');
begin
  select * into s from suppliers where id = p_id for update;
  if s.id is null then
    raise exception 'Supplier not found.';
  end if;
  if s.status <> 'proposed' then
    raise exception 'This supplier is %, not waiting for approval.', s.status;
  end if;
  if not (v_principal or v_secretary) then
    raise exception 'Only the principal and the college secretary approve suppliers.';
  end if;
  if auth.uid() in (s.principal_approved_by, s.secretary_approved_by) then
    raise exception 'You have already approved this supplier. It needs the other approver.';
  end if;
  if v_principal and s.principal_approved_by is null then
    update suppliers set principal_approved_by = auth.uid(), principal_approved_at = now() where id = p_id;
  elsif v_secretary and s.secretary_approved_by is null then
    update suppliers set secretary_approved_by = auth.uid(), secretary_approved_at = now() where id = p_id;
  end if;
  select * into s from suppliers where id = p_id;
  if not s.practice and (s.principal_approved_by is null or s.secretary_approved_by is null) then
    return 'waiting';
  end if;
  update suppliers set status = 'approved', status_changed_by = auth.uid(), status_changed_at = now(), status_note = null where id = p_id;
  return 'approved';
end;
$$;

create or replace function public.set_supplier_status(p_id bigint, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s suppliers;
begin
  if not is_budget_approver() then
    raise exception 'Only the principal or the college secretary can suspend, archive or restore a supplier.';
  end if;
  if p_status not in ('suspended', 'archived', 'approved') then
    raise exception 'A supplier can be suspended, archived or restored.';
  end if;
  select * into s from suppliers where id = p_id for update;
  if s.id is null then
    raise exception 'Supplier not found.';
  end if;
  if p_status = 'approved' and (s.status not in ('suspended', 'archived')
       or (not s.practice and (s.principal_approved_by is null or s.secretary_approved_by is null))) then
    raise exception 'Only a supplier that was approved can be restored.';
  end if;
  update suppliers set status = p_status, status_changed_by = auth.uid(), status_changed_at = now(),
    status_note = nullif(btrim(p_note), '')
  where id = p_id;
end;
$$;

-- 10. Requisitions ---------------------------------------------------------------------

create or replace function public.requisition_event(p_id bigint, p_event text, p_note text)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into requisition_events (requisition_id, event, note, done_by, done_by_name)
  values (p_id, p_event, nullif(btrim(p_note), ''), auth.uid(), profile_display_name(auth.uid()));
$$;
revoke execute on function public.requisition_event(bigint, text, text) from public, anon, authenticated;

-- p_items: [{"description": "...", "quantity": 2, "unit": "boxes"}, ...]
create or replace function public.raise_requisition(
  p_term_id integer, p_cost_centre_id bigint, p_reason text, p_needed_by date, p_items jsonb, p_practice boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_staff integer := finance_staff_id();
  v_id bigint;
  v_item jsonb;
begin
  if v_staff is null then
    raise exception 'Only staff can raise a requisition.';
  end if;
  if p_practice and not can_view_budget() then
    raise exception 'Practice requisitions are only for showing the process.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say what the requisition is for.';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item.';
  end if;
  if p_cost_centre_id is not null and not exists (
       select 1 from cost_centres where id = p_cost_centre_id and active and kind in ('allocated', 'ring_fenced')) then
    raise exception 'Choose an allocated or ring-fenced cost centre.';
  end if;
  insert into requisitions (term_id, practice, requested_by, requester_staff_id, cost_centre_id, reason, needed_by)
  values (p_term_id, p_practice, auth.uid(), v_staff, p_cost_centre_id, btrim(p_reason), p_needed_by)
  returning id into v_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce(btrim(v_item->>'description'), '') = '' then
      continue;
    end if;
    insert into requisition_items (requisition_id, description, quantity, unit)
    values (v_id, btrim(v_item->>'description'), coalesce(nullif(v_item->>'quantity', '')::numeric, 1), nullif(btrim(v_item->>'unit'), ''));
  end loop;
  perform requisition_event(v_id, 'Raised', null);
  -- The principal's own requisitions count as signed when raised.
  if holds_staff_role('principal') then
    update requisitions set status = 'signed', signed_by = auth.uid(), signed_at = now() where id = v_id;
    perform requisition_event(v_id, 'Signed', 'Raised by the principal');
  end if;
  return v_id;
end;
$$;

create or replace function public.sign_requisition(p_id bigint, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if not holds_staff_role('principal') then
    raise exception 'Requisitions are signed by the principal.';
  end if;
  if r.status <> 'submitted' then
    raise exception 'This requisition is %, not waiting to be signed.', replace(r.status, '_', ' ');
  end if;
  if p_approve then
    update requisitions set status = 'signed', signed_by = auth.uid(), signed_at = now() where id = p_id;
    perform requisition_event(p_id, 'Signed', p_note);
  else
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'Give the reason for rejecting it.';
    end if;
    update requisitions set status = 'rejected', closed_by = auth.uid(), closed_at = now(), close_note = btrim(p_note) where id = p_id;
    perform requisition_event(p_id, 'Rejected', p_note);
  end if;
end;
$$;

-- p_prices: {"<item_id>": unit_price, ...}
create or replace function public.cost_requisition(p_id bigint, p_supplier_id bigint, p_cost_centre_id bigint, p_prices jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
  v_item record;
  v_price numeric;
  v_total numeric;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if not finance_can_act('college_secretary', r.practice) then
    raise exception 'Requisitions are costed by the college secretary.';
  end if;
  if r.status not in ('signed', 'costed', 'awaiting_release') then
    raise exception 'This requisition is %, so it can''t be costed now.', replace(r.status, '_', ' ');
  end if;
  if not exists (select 1 from suppliers where id = p_supplier_id and status = 'approved' and practice = r.practice) then
    raise exception 'Choose an approved supplier%.', case when r.practice then ' from the practice list' else '' end;
  end if;
  if not exists (select 1 from cost_centres where id = p_cost_centre_id and active and kind in ('allocated', 'ring_fenced')) then
    raise exception 'Choose an allocated or ring-fenced cost centre.';
  end if;
  for v_item in select id from requisition_items where requisition_id = p_id loop
    v_price := nullif(p_prices->>v_item.id::text, '')::numeric;
    if v_price is null or v_price < 0 then
      raise exception 'Give a price for every item.';
    end if;
    update requisition_items set unit_price = v_price where id = v_item.id;
  end loop;
  select sum(quantity * unit_price) into v_total from requisition_items where requisition_id = p_id;
  update requisitions set supplier_id = p_supplier_id, cost_centre_id = p_cost_centre_id, total = round(v_total, 2),
    status = 'costed', costed_by = auth.uid(), costed_at = now()
  where id = p_id;
  perform requisition_event(p_id, 'Costed', 'Total ' || to_char(v_total, 'FM999,999,990') || ', ' ||
    (select name from suppliers where id = p_supplier_id) || ', ' || (select name from cost_centres where id = p_cost_centre_id));
  return v_total;
end;
$$;

-- Returns 'approved', or 'awaiting_release' with the shortfall in the timeline.
create or replace function public.approve_requisition(p_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
  v_left numeric;
  v_cash numeric;
  v_used numeric;
  v_requester_is_cs boolean;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if r.status not in ('costed', 'awaiting_release') then
    raise exception 'This requisition is %, so it can''t be approved now.', replace(r.status, '_', ' ');
  end if;
  select exists (select 1 from staff_roles where staff_id = r.requester_staff_id and role_name = 'college_secretary')
    into v_requester_is_cs;
  if not r.practice then
    if r.requested_by = auth.uid() and not v_requester_is_cs then
      raise exception 'Nobody approves their own requisition.';
    end if;
    if v_requester_is_cs then
      if not holds_staff_role('principal') then
        raise exception 'The college secretary''s own requisitions are approved by the principal.';
      end if;
    elsif not holds_staff_role('college_secretary') then
      raise exception 'Requisitions are approved by the college secretary.';
    end if;
  elsif not finance_can_act('college_secretary', true) then
    raise exception 'Requisitions are approved by the college secretary.';
  end if;

  v_left := cost_centre_remaining(r.term_id, r.practice, r.cost_centre_id);
  if r.total > v_left then
    update requisitions set status = 'awaiting_release' where id = p_id;
    perform requisition_event(p_id, 'Waiting for contingency',
      (select name from cost_centres where id = r.cost_centre_id) || ' has ' || to_char(greatest(v_left, 0), 'FM999,999,990')
      || ' left; short by ' || to_char(r.total - greatest(v_left, 0), 'FM999,999,990'));
    return 'awaiting_release';
  end if;

  -- Invoiced, spend to cash: real money is committed only up to what has
  -- been collected for the term. Practice skips it (no Term 2 fees yet).
  if not r.practice then
    v_cash := term_cash_collected(r.term_id);
    select coalesce(sum(case when status = 'paid' then paid_total else total end), 0) into v_used
    from requisitions where term_id = r.term_id and not practice and status in ('approved', 'part_received', 'received', 'paid');
    if v_used + r.total > v_cash then
      raise exception 'Only % has been collected for this term and % is already committed or spent, so this can''t be approved until more fees are paid.',
        to_char(v_cash, 'FM999,999,990'), to_char(v_used, 'FM999,999,990');
    end if;
  end if;

  update requisitions set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform requisition_event(p_id, 'Approved', 'Committed ' || to_char(r.total, 'FM999,999,990'));
  return 'approved';
end;
$$;

-- p_received: {"<item_id>": quantity received so far, ...}
create or replace function public.receive_requisition(p_id bigint, p_received jsonb, p_note text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
  v_item record;
  v_qty numeric;
  v_all boolean;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if r.status not in ('approved', 'part_received', 'paid') then
    raise exception 'Goods are recorded once a requisition is approved.';
  end if;
  if not (r.requested_by = auth.uid() or (r.practice and holds_staff_role('principal'))
          or (holds_staff_role('college_secretary') and r.approved_by is distinct from auth.uid())) then
    raise exception 'Delivery is recorded by the person who asked for it (not the approver).';
  end if;
  for v_item in select id, quantity from requisition_items where requisition_id = p_id loop
    v_qty := nullif(p_received->>v_item.id::text, '')::numeric;
    if v_qty is not null then
      if v_qty < 0 or v_qty > v_item.quantity then
        raise exception 'Received quantities must be between 0 and the quantity ordered.';
      end if;
      update requisition_items set quantity_received = v_qty where id = v_item.id;
    end if;
  end loop;
  select bool_and(quantity_received >= quantity) into v_all from requisition_items where requisition_id = p_id;
  if r.status <> 'paid' then
    update requisitions set status = case when v_all then 'received' else 'part_received' end where id = p_id;
  end if;
  perform requisition_event(p_id, case when v_all then 'Received in full' else 'Part received' end, p_note);
  return case when v_all then 'received' else 'part_received' end;
end;
$$;

create or replace function public.pay_requisition(p_id bigint, p_amount numeric, p_paid_on date, p_method text, p_reference text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if not finance_can_act('bursar', r.practice) then
    raise exception 'Requisitions are paid by the bursar.';
  end if;
  if r.status not in ('approved', 'part_received', 'received') then
    raise exception 'Only an approved requisition can be paid.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Give the amount paid.';
  end if;
  if r.paid_total + p_amount > r.total then
    raise exception 'That is more than the approved total (% left to pay). A higher price must be costed and approved again.',
      to_char(r.total - r.paid_total, 'FM999,999,990');
  end if;
  insert into requisition_payments (requisition_id, amount, paid_on, method, reference, recorded_by)
  values (p_id, p_amount, coalesce(p_paid_on, current_date), nullif(btrim(p_method), ''), nullif(btrim(p_reference), ''), auth.uid());
  update requisitions set paid_total = paid_total + p_amount,
    status = case when paid_total + p_amount >= total then 'paid' else status end
  where id = p_id;
  perform requisition_event(p_id, 'Paid', to_char(p_amount, 'FM999,999,990') || coalesce(' by ' || nullif(btrim(p_method), ''), '')
    || coalesce(', ref ' || nullif(btrim(p_reference), ''), ''));
  return case when r.paid_total + p_amount >= r.total then 'paid' else 'part paid' end;
end;
$$;

-- Withdrawn by the requester before approval, or cancelled by the college
-- secretary (or the principal) at any point before it is fully paid. What is
-- still committed is released. Never deleted.
create or replace function public.cancel_requisition(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r requisitions;
begin
  select * into r from requisitions where id = p_id for update;
  if r.id is null then
    raise exception 'Requisition not found.';
  end if;
  if r.status in ('paid', 'rejected', 'cancelled') then
    raise exception 'This requisition is already %.', r.status;
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Give the reason.';
  end if;
  if not (
       (r.requested_by = auth.uid() and r.status in ('submitted', 'signed', 'costed', 'awaiting_release'))
       or is_budget_approver()) then
    raise exception 'After approval only the college secretary or the principal can cancel a requisition.';
  end if;
  -- Anything already paid stays spent; the rest is released.
  update requisitions set status = 'cancelled', total = case when paid_total > 0 then paid_total else total end,
    closed_by = auth.uid(), closed_at = now(), close_note = btrim(p_note)
  where id = p_id;
  perform requisition_event(p_id, 'Cancelled', p_note);
end;
$$;

-- 11. Clearing practice entries --------------------------------------------------------

create or replace function public.clear_practice_entries()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_b integer; v_r integer; v_s integer; v_c integer;
begin
  if not holds_staff_role('principal') then
    raise exception 'Only the principal clears practice entries.';
  end if;
  update term_budgets set status = 'cancelled', closed_by = auth.uid(), closed_at = now(), close_note = 'Practice cleared'
  where practice and status in ('pending', 'approved');
  get diagnostics v_b = row_count;
  update requisitions set status = 'cancelled', closed_by = auth.uid(), closed_at = now(), close_note = 'Practice cleared'
  where practice and status not in ('cancelled', 'rejected');
  get diagnostics v_r = row_count;
  update contingency_releases set cancelled_by = auth.uid(), cancelled_at = now(), cancel_note = 'Practice cleared'
  where practice and cancelled_at is null;
  get diagnostics v_c = row_count;
  update suppliers set status = 'archived', status_changed_by = auth.uid(), status_changed_at = now(), status_note = 'Practice cleared'
  where practice and status <> 'archived';
  get diagnostics v_s = row_count;
  return jsonb_build_object('budgets', v_b, 'requisitions', v_r, 'releases', v_c, 'suppliers', v_s);
end;
$$;

-- 12. Who may run what ---------------------------------------------------------------

revoke execute on function public.propose_term_budget(integer, jsonb, boolean, text) from public, anon;
revoke execute on function public.approve_term_budget(bigint) from public, anon;
revoke execute on function public.cancel_term_budget(bigint, text) from public, anon;
revoke execute on function public.release_contingency(integer, bigint, numeric, text, bigint, boolean) from public, anon;
revoke execute on function public.propose_supplier(jsonb, boolean) from public, anon;
revoke execute on function public.update_supplier(bigint, jsonb) from public, anon;
revoke execute on function public.approve_supplier(bigint) from public, anon;
revoke execute on function public.set_supplier_status(bigint, text, text) from public, anon;
revoke execute on function public.raise_requisition(integer, bigint, text, date, jsonb, boolean) from public, anon;
revoke execute on function public.sign_requisition(bigint, boolean, text) from public, anon;
revoke execute on function public.cost_requisition(bigint, bigint, bigint, jsonb) from public, anon;
revoke execute on function public.approve_requisition(bigint) from public, anon;
revoke execute on function public.receive_requisition(bigint, jsonb, text) from public, anon;
revoke execute on function public.pay_requisition(bigint, numeric, date, text, text) from public, anon;
revoke execute on function public.cancel_requisition(bigint, text) from public, anon;
revoke execute on function public.clear_practice_entries() from public, anon;
grant execute on function public.propose_term_budget(integer, jsonb, boolean, text) to authenticated;
grant execute on function public.approve_term_budget(bigint) to authenticated;
grant execute on function public.cancel_term_budget(bigint, text) to authenticated;
grant execute on function public.release_contingency(integer, bigint, numeric, text, bigint, boolean) to authenticated;
grant execute on function public.propose_supplier(jsonb, boolean) to authenticated;
grant execute on function public.update_supplier(bigint, jsonb) to authenticated;
grant execute on function public.approve_supplier(bigint) to authenticated;
grant execute on function public.set_supplier_status(bigint, text, text) to authenticated;
grant execute on function public.raise_requisition(integer, bigint, text, date, jsonb, boolean) to authenticated;
grant execute on function public.sign_requisition(bigint, boolean, text) to authenticated;
grant execute on function public.cost_requisition(bigint, bigint, bigint, jsonb) to authenticated;
grant execute on function public.approve_requisition(bigint) to authenticated;
grant execute on function public.receive_requisition(bigint, jsonb, text) to authenticated;
grant execute on function public.pay_requisition(bigint, numeric, date, text, text) to authenticated;
grant execute on function public.cancel_requisition(bigint, text) to authenticated;
grant execute on function public.clear_practice_entries() to authenticated;

-- 13. Shown padlocked at /admin/permissions ----------------------------------------

insert into public.role_ability_tables (table_name, stage) values
  ('term_budgets', 7), ('term_budget_lines', 7), ('contingency_releases', 7), ('suppliers', 7),
  ('requisitions', 7), ('requisition_items', 7), ('requisition_events', 7), ('requisition_payments', 7)
on conflict (table_name) do nothing;
insert into public.role_ability_locks (table_name, action, reason)
select t, a, case a
  when 'view' then 'The principal only, while the budget is being built (requesters see their own requisitions)'
  when 'delete' then 'Never deleted; cancelled or archived instead (the principal)'
  else 'Only through the budget''s own steps, each checking who may do it' end
from unnest(array['term_budgets', 'term_budget_lines', 'contingency_releases', 'suppliers',
                  'requisitions', 'requisition_items', 'requisition_events', 'requisition_payments']) t
cross join unnest(array['view', 'add', 'edit', 'delete']) a
on conflict (table_name, action) do nothing;
