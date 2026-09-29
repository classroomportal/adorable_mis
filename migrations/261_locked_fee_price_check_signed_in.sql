-- Migration 261: the locked-fee price check exempts only changes with no
-- sign-in behind them.
--
-- Why: migration 260's enforce_locked_fee_price() let a charge through when
-- session_user was 'postgres', meaning the SQL editor. Testing showed that
-- is the wrong signal: a connection can be made as postgres while carrying
-- a Formwork sign-in, and the rule is about the person, not the connection.
-- The check now applies whenever someone is signed in (auth.uid() is set),
-- which covers every page and every function the app calls, and is skipped
-- only for changes made directly in the database with no sign-in (the
-- principal's own route, which records 'Principal (direct)').

set local formwork.change_note = 'Principal (direct)';

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
