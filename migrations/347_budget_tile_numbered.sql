-- Migration 347: the Budget tile's pages, numbered in process order.
--
-- Why: the principal, 3 Oct 2026, preparing to show the college secretary
-- how the budget works: "Number tiles with shortened words titles". The
-- pages at /admin/permissions get the same short, numbered names and order
-- as the tile: 1 Funds, 2 Fees, 3 Forecast, 4 Income, 5 Budget,
-- 6 Suppliers, 7 Requests, 8 Approvals. Labels only; who may see each page
-- is unchanged (the principal only, while it is being built).

set local formwork.change_note = 'Principal (direct)';

update public.resources r set label = v.label, sort_order = v.ord
from (values
  ('/finance/funds', '1 Funds', 1),
  ('/finance/term-fees', '2 Fees', 2),
  ('/finance/forecast', '3 Forecast', 3),
  ('/finance/budget', '4 Income', 4),
  ('/finance/term-budget', '5 Budget', 5),
  ('/finance/suppliers', '6 Suppliers', 6),
  ('/finance/requisitions', '7 Requests', 7),
  ('/finance/approvals', '8 Approvals', 8)
) as v(key, label, ord)
where r.resource_key = v.key;
