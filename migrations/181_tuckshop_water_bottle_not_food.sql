-- Migration 181: tuckshop item 9 is a Water Bottle (the container), not
-- bottled water — rename it and take it out of the food limit.
--
-- The school pointed out on Fri 25 Sep 2026 that "Bottled Water (50cl)" at
-- NGN 4,300 is a reusable water bottle. Migration 180 had classed it as a
-- drink (is_food = true), so it would have counted towards a student's
-- 2 snacks-and-drinks per Saturday. When this was written nobody had ever
-- ordered or bought it (no preorder lines, nothing in
-- tuckshop_preorder_trim_backup_180, no purchases), so no order was trimmed
-- because of the mistake and nothing else needs correcting.
--
-- Matched by id and old name together, so this can't rename a different
-- item if ids ever differ between environments.

update tuckshop_items
set name = 'Water Bottle',
    is_food = false
where id = 9
  and name = 'Bottled Water (50cl)';
