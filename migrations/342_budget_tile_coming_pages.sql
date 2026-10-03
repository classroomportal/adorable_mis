-- Migration 342: the Budget tile's pages still to be built.
--
-- Why: the principal, 3 Oct 2026: "put the links on the tile ready". The
-- tile now shows the whole budget process: besides Term forecast, Fee income
-- by fund and Funds & cost centres (migration 341), it links to Term budget,
-- Requisitions, Requisition approvals and Approved suppliers, each a page
-- saying what it will do until it is built. Granted to the principal only,
-- like the rest of the budget while it is being built. No data behind them
-- yet, so nothing here changes who can see or do anything.

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order) values
  ('/finance/term-budget', 'Term budget', 'Budget', 4),
  ('/finance/requisitions', 'Requisitions', 'Budget', 5),
  ('/finance/approvals', 'Requisition approvals', 'Budget', 6),
  ('/finance/suppliers', 'Approved suppliers', 'Budget', 7)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('principal', '/finance/term-budget'),
  ('principal', '/finance/requisitions'),
  ('principal', '/finance/approvals'),
  ('principal', '/finance/suppliers')
on conflict do nothing;
