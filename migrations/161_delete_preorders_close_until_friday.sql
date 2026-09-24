-- Migration 161: delete the tuckshop preorders placed on Thu 24 Sep 2026 and
-- keep student ordering shut until Friday 25 September.
--
-- Asked for on Thu 24 Sep 2026: prices are still being adjusted, so the
-- orders already placed must be deleted (not cancelled, as migration 119
-- did), and ordering should start from tomorrow morning, Lagos time.
--
-- What's deleted: the 25 preorders that were 'pending' when this was
-- written, all for Sat 26 Sep and all placed between 08:15 and 12:38 Lagos
-- time that morning, once 119's closure had lapsed. None had been fulfilled
-- (purchase_id is null on every one), so no tuckshop_purchases rows exist
-- for them and no balance changes. Deleting rather than cancelling because
-- they were priced at prices that are being changed — students shouldn't
-- see them as orders that stand. The 24 orders 119 cancelled are left alone.
--
-- The delete is scoped to pending, unfulfilled orders created before a
-- fixed time, so re-running this migration can never remove orders placed
-- after it.
--
-- Reopening: tuckshop_ordering_closed_until = 2026-09-25 blocks the rest of
-- Thursday and reopens at 00:00 Friday Lagos time (the closure works in
-- whole days). Orders placed on Friday are for Sat 26 Sep and lock at 11pm
-- Friday under migration 160.

-- Close first, so nothing new arrives while the old orders are removed.
update system_settings
set tuckshop_ordering_closed_until = date '2026-09-25',
    tuckshop_ordering_closed_note = 'Closed 24 Sep 2026 while prices are adjusted; orders placed that morning deleted. Reopens Friday 25 Sep.',
    updated_at = now();

delete from tuckshop_preorder_items
where preorder_id in (
  select id from tuckshop_preorders
  where status = 'pending'
    and purchase_id is null
    and created_at < timestamptz '2026-09-24 14:00:00+01'
);

delete from tuckshop_preorders
where status = 'pending'
  and purchase_id is null
  and created_at < timestamptz '2026-09-24 14:00:00+01';
