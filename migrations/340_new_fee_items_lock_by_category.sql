-- Migration 340: a fee item added from the app is locked to its approved
-- price, by year group, when its category is a term fee; exam entry joins
-- those categories.
--
-- Why: the principal, 3 Oct 2026, planning the Term 2 budget: fees are
-- termly, the forecast grid assumes every year group pays the same "but
-- several fees will need to be entered for different years" (exam entry is
-- the example). Prices by year group (fee_item_year_prices) can only be set
-- for a locked item (migration 260), and the lock was set once, by category,
-- for the items that existed then. guard_fee_prices() refuses price_locked
-- from the app, so any item added since (Exam Entry, a new activity) could
-- never be locked: it couldn't have year-group prices, and the bursar could
-- charge it at any amount, getting round the two-person price approval
-- (migration 259).
--
-- How it works:
--   * lock_fee_item_by_category(), a BEFORE INSERT OR UPDATE trigger on
--     fee_items, sets price_locked when an item is added with, or changed
--     to, a locked category: tuition, activity, technology, medical, and now
--     exam / exams / exam entry. It runs after trg_guard_fee_prices (the
--     triggers fire in name order), so the guard still refuses price_locked
--     sent by the app, and the lock comes only from the category. It never
--     unlocks: guard_fee_prices() already refuses a locked item's category
--     change from the app.
--   * A locked item then gets year-group prices the usual way: proposed at
--     Fee Items (Prices by year), approved by the principal and the college
--     secretary, enforced at charging by enforce_locked_fee_price(), and
--     used by the term forecast (migration 339).
--   * Damages, Tuckshop and discounts stay free, as decided in migration 260.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.fee_category_is_locked(p_category text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select lower(btrim(coalesce(p_category, ''))) in
    ('tuition', 'activity', 'technology', 'medical', 'exam', 'exams', 'exam entry');
$$;

create or replace function public.lock_fee_item_by_category()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if fee_category_is_locked(new.category) then
    new.price_locked := true;
  end if;
  return new;
end;
$$;
revoke execute on function public.lock_fee_item_by_category() from public, anon, authenticated;

create trigger trg_lock_fee_item_by_category
  before insert or update of category on public.fee_items
  for each row execute function public.lock_fee_item_by_category();

-- Any item already in a locked category but added since migration 260.
update public.fee_items set price_locked = true
where not price_locked and fee_category_is_locked(category);
