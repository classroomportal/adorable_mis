-- Migration 162: delete the cancelled tuckshop preorders.
--
-- Asked for on Thu 24 Sep 2026, after migration 161 deleted that morning's
-- pending orders: remove the cancelled ones too, so students' order history
-- starts clean once ordering reopens on Friday.
--
-- What's deleted: the 24 preorders that were 'cancelled' when this was
-- written (placed 6-22 Sep 2026; 22 of them cancelled by migration 119).
-- None was ever fulfilled — purchase_id is null on every one — so there
-- are no tuckshop_purchases rows behind them and no balance changes. This
-- reverses 119's choice to keep them as an audit trail, at the school's
-- request.
--
-- Scoped by a fixed created_at cutoff so re-running can never remove an
-- order cancelled after this migration.

delete from tuckshop_preorder_items
where preorder_id in (
  select id from tuckshop_preorders
  where status = 'cancelled'
    and purchase_id is null
    and created_at < timestamptz '2026-09-24 14:00:00+01'
);

delete from tuckshop_preorders
where status = 'cancelled'
  and purchase_id is null
  and created_at < timestamptz '2026-09-24 14:00:00+01';
